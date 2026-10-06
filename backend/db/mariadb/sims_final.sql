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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.academic_years: ~1 rows (approximately)
INSERT INTO `academic_years` (`yearID`, `id`, `name`, `YEAR`, `start_date`, `end_date`, `status`, `archived_at`, `absent_as_zero`, `allow_makeup`, `drop_lowest_count`, `created_at`, `updated_at`, `created_by`, `updated_by`) VALUES
	(NULL, '1947dc0a-1306-40ac-992b-b808f03f1651', '2026-2027', NULL, '2026-08-15', '2027-06-19', 'active', NULL, NULL, NULL, NULL, '2026-10-04 18:02:41', NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b', NULL);

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

-- Dumping data for table sims.announcement_reads: ~0 rows (approximately)

-- Dumping structure for table sims.announcements
CREATE TABLE IF NOT EXISTS `announcements` (
  `id` uuid NOT NULL COMMENT 'PK',
  `author_id` uuid DEFAULT NULL COMMENT 'FK -> users (display author); nullable per ORM',
  `title` varchar(150) NOT NULL,
  `body` text NOT NULL,
  `audience` enum('all','students','teachers','class') NOT NULL COMMENT 'all / students / teachers / class',
  `published_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT 'Publish date; ordering basis',
  `expires_at` datetime DEFAULT NULL COMMENT 'Optional expiry',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `offering_id` uuid DEFAULT NULL COMMENT 'FK -> course_offerings; required iff audience=''class''. NULL = school-wide (D31; was class_id).',
  PRIMARY KEY (`id`),
  KEY `fk_announcements_author` (`author_id`),
  KEY `fk_announcements_created_by` (`created_by`),
  KEY `fk_announcements_updated_by` (`updated_by`),
  KEY `ix_announcements_audience` (`audience`),
  KEY `ix_announcements_published` (`published_at`),
  KEY `ix_announcements_offering` (`offering_id`),
  CONSTRAINT `fk_announcements_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_announcements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_announcements_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_announcements_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_announcements_offering_audience` CHECK (`audience` = 'class' = (`offering_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.announcements: ~0 rows (approximately)

-- Dumping structure for table sims.application_documents
CREATE TABLE IF NOT EXISTS `application_documents` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id` uuid NOT NULL COMMENT 'FK -> applications',
  `document_type` enum('passport_photo','hs_diploma','recommendation_form','social_security_card','course_outline','transcript','cta','other') NOT NULL COMMENT 'Form Section F checklist, plus the credit-transfer documents',
  `file_name` varchar(150) DEFAULT NULL COMMENT 'Original name',
  `storage_key` varchar(200) DEFAULT NULL COMMENT 'Object-storage path/key',
  `content_type` varchar(100) DEFAULT NULL COMMENT 'MIME',
  `size_bytes` bigint(20) DEFAULT NULL,
  `received` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Ticked even when no file is uploaded (paper submission)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_application_documents_application` (`application_id`),
  CONSTRAINT `fk_application_documents_application` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.application_documents: ~3 rows (approximately)
INSERT INTO `application_documents` (`id`, `application_id`, `document_type`, `file_name`, `storage_key`, `content_type`, `size_bytes`, `received`, `created_at`, `updated_at`) VALUES
	('3e9857f8-ddda-4920-bf73-31b4b0290eea', '82eba5f6-5355-45de-abc2-2db539bf79ac', 'hs_diploma', NULL, NULL, NULL, NULL, 1, '2026-10-04 18:09:39', NULL),
	('6a8b0889-dcfa-4529-a1e0-9afede77330a', '82eba5f6-5355-45de-abc2-2db539bf79ac', 'passport_photo', NULL, NULL, NULL, NULL, 1, '2026-10-04 18:09:39', NULL),
	('b9313fe7-22cd-44f2-8e41-d95957b06588', '82eba5f6-5355-45de-abc2-2db539bf79ac', 'social_security_card', NULL, NULL, NULL, NULL, 1, '2026-10-04 18:09:39', NULL);

-- Dumping structure for table sims.application_education
CREATE TABLE IF NOT EXISTS `application_education` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id` uuid NOT NULL COMMENT 'FK -> applications',
  `institution` varchar(250) NOT NULL COMMENT 'Name of Institution',
  `education_level` enum('High School','Tertiary') NOT NULL DEFAULT 'High School',
  `graduated` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Graduated? (Yes or No)',
  `graduation_date` date DEFAULT NULL,
  `sort_order` smallint(6) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_application_education_application` (`application_id`),
  CONSTRAINT `fk_application_education_application` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.application_education: ~0 rows (approximately)

-- Dumping structure for table sims.application_temp
CREATE TABLE IF NOT EXISTS `application_temp` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `school_year` varchar(20) DEFAULT NULL COMMENT 'Form header: School year',
  `firstname` varchar(50) NOT NULL,
  `middlename` varchar(50) DEFAULT NULL,
  `lastname` varchar(50) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `ssno` varchar(9) DEFAULT NULL COMMENT 'Social Security No.',
  `gender` varchar(25) DEFAULT NULL,
  `civil_status` varchar(50) DEFAULT NULL,
  `religion` varchar(100) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(254) DEFAULT NULL,
  `has_health_condition` tinyint(1) NOT NULL DEFAULT 0,
  `health_condition_note` text DEFAULT NULL,
  `street` varchar(200) DEFAULT NULL,
  `city_town_village` varchar(200) DEFAULT NULL,
  `district` enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') DEFAULT NULL,
  `mother_name` varchar(200) DEFAULT NULL,
  `father_name` varchar(200) DEFAULT NULL,
  `nok_name` varchar(200) DEFAULT NULL,
  `nok_relationship` varchar(100) DEFAULT NULL,
  `nok_phone` varchar(50) DEFAULT NULL,
  `atlib_exam` tinyint(1) NOT NULL DEFAULT 0,
  `num_csec` smallint(6) DEFAULT NULL COMMENT 'Number of CSEC Exams (1-8+)',
  `education_json` longtext DEFAULT NULL COMMENT 'Section B institutions; expanded into application_education on submit',
  `finance_name` varchar(200) DEFAULT NULL,
  `finance_phone` varchar(50) DEFAULT NULL,
  `finance_email` varchar(254) DEFAULT NULL,
  `recommendation_received` tinyint(1) NOT NULL DEFAULT 0,
  `program_id` uuid DEFAULT NULL COMMENT 'FK -> programs',
  `year_of_study` enum('First','Second') DEFAULT NULL,
  `enrollment_load` enum('Part Time','Full Time','Transient') DEFAULT NULL,
  `documents_json` longtext DEFAULT NULL COMMENT 'Section F checklist; expanded into application_documents on submit',
  `applicant_signed_at` date DEFAULT NULL,
  `guardian_signed_at` date DEFAULT NULL COMMENT 'Required only if the applicant is under 18',
  `academic_year_id` uuid DEFAULT NULL COMMENT 'FK -> academic_years',
  `enrolment_status` varchar(50) DEFAULT NULL,
  `comments` text DEFAULT NULL COMMENT 'Comments/Observations',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_apptemp_created_by` (`created_by`,`lastname`,`firstname`),
  KEY `fk_apptemp_program` (`program_id`),
  KEY `fk_apptemp_year` (`academic_year_id`),
  KEY `fk_apptemp_updated_by` (`updated_by`),
  CONSTRAINT `fk_apptemp_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_apptemp_num_csec` CHECK (`num_csec` is null or `num_csec` between 0 and 20),
  CONSTRAINT `ck_apptemp_education_json` CHECK (`education_json` is null or json_valid(`education_json`)),
  CONSTRAINT `ck_apptemp_documents_json` CHECK (`documents_json` is null or json_valid(`documents_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.application_temp: ~0 rows (approximately)

-- Dumping structure for table sims.applications
CREATE TABLE IF NOT EXISTS `applications` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_number` varchar(20) DEFAULT NULL COMMENT 'Human reference, APP-YYYY-NNNNN (D44). Allocated at create from number_sequences; NULL only mid-migration.',
  `status` enum('draft','submitted','under_review','documents_pending','eligible','accepted','rejected','deferred','withdrawn','enrolled') NOT NULL DEFAULT 'draft' COMMENT 'D44, client vocabulary. draft/submitted/under_review unchanged. documents_pending = returned to the applicant for missing paperwork. eligible = meets the requirements, awaiting a decision. rejected was `denied` before D44. deferred = decision held to a later intake. enrolled = accepted AND registered. accepted/rejected/withdrawn/enrolled are terminal.',
  `school_year` varchar(20) DEFAULT NULL COMMENT 'Form header: School year',
  `firstname` varchar(50) NOT NULL,
  `middlename` varchar(50) DEFAULT NULL,
  `lastname` varchar(50) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `ssno` varchar(9) DEFAULT NULL COMMENT 'Social Security No.',
  `gender` varchar(25) DEFAULT NULL,
  `civil_status` varchar(50) DEFAULT NULL,
  `religion` varchar(100) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL COMMENT 'Personal telephone number',
  `email` varchar(254) DEFAULT NULL COMMENT 'Personal e-mail address',
  `has_health_condition` tinyint(1) NOT NULL DEFAULT 0,
  `health_condition_note` text DEFAULT NULL,
  `street` varchar(200) DEFAULT NULL,
  `city_town_village` varchar(200) DEFAULT NULL,
  `district` enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') DEFAULT NULL,
  `mother_name` varchar(200) DEFAULT NULL,
  `father_name` varchar(200) DEFAULT NULL,
  `nok_name` varchar(200) DEFAULT NULL,
  `nok_relationship` varchar(100) DEFAULT NULL,
  `nok_phone` varchar(50) DEFAULT NULL,
  `atlib_exam` tinyint(1) NOT NULL DEFAULT 0,
  `num_csec` smallint(6) DEFAULT NULL COMMENT 'Number of CSEC Exams (1-8+)',
  `finance_name` varchar(200) DEFAULT NULL,
  `finance_phone` varchar(50) DEFAULT NULL,
  `finance_email` varchar(254) DEFAULT NULL,
  `recommendation_received` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'BAJC Character and Academic Recommendation Form, completed by a high school teacher',
  `program_id` uuid DEFAULT NULL COMMENT 'FK -> programs',
  `year_of_study` enum('First','Second') DEFAULT NULL,
  `enrollment_load` enum('Part Time','Full Time','Transient') DEFAULT NULL,
  `applicant_signed_at` date DEFAULT NULL,
  `guardian_signed_at` date DEFAULT NULL COMMENT 'Required only if the applicant is under 18',
  `date_accepted` date DEFAULT NULL,
  `academic_year_id` uuid DEFAULT NULL COMMENT 'FK -> academic_years',
  `enrolment_status` varchar(50) DEFAULT NULL,
  `student_code` varchar(20) DEFAULT NULL COMMENT 'The YYYYMM### issued on acceptance',
  `conditions_of_admission` varchar(180) DEFAULT NULL COMMENT 'Conditions attached to an acceptance (D44, from the client dump). Free text.',
  `comments` text DEFAULT NULL COMMENT 'Comments/Observations',
  `decided_by_user_id` uuid DEFAULT NULL COMMENT 'FK -> users (Dean or Registrar)',
  `decided_at` datetime DEFAULT NULL,
  `student_id` uuid DEFAULT NULL COMMENT 'FK -> student_profiles; set on acceptance',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_applications_number` (`application_number`),
  KEY `ix_applications_status` (`status`),
  KEY `ix_applications_lastname` (`lastname`,`firstname`),
  KEY `fk_applications_program` (`program_id`),
  KEY `fk_applications_year` (`academic_year_id`),
  KEY `fk_applications_student` (`student_id`),
  KEY `fk_applications_decided_by` (`decided_by_user_id`),
  KEY `fk_applications_created_by` (`created_by`),
  KEY `fk_applications_updated_by` (`updated_by`),
  CONSTRAINT `fk_applications_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_decided_by` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_applications_num_csec` CHECK (`num_csec` is null or `num_csec` between 0 and 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.applications: ~1 rows (approximately)
INSERT INTO `applications` (`id`, `application_number`, `status`, `school_year`, `firstname`, `middlename`, `lastname`, `date_of_birth`, `ssno`, `gender`, `civil_status`, `religion`, `phone`, `email`, `has_health_condition`, `health_condition_note`, `street`, `city_town_village`, `district`, `mother_name`, `father_name`, `nok_name`, `nok_relationship`, `nok_phone`, `atlib_exam`, `num_csec`, `finance_name`, `finance_phone`, `finance_email`, `recommendation_received`, `program_id`, `year_of_study`, `enrollment_load`, `applicant_signed_at`, `guardian_signed_at`, `date_accepted`, `academic_year_id`, `enrolment_status`, `student_code`, `conditions_of_admission`, `comments`, `decided_by_user_id`, `decided_at`, `student_id`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`) VALUES
	('82eba5f6-5355-45de-abc2-2db539bf79ac', 'APP-2026-00001', 'accepted', '2026-2027', 'Turo', NULL, 'Hernandez', '2000-02-01', '021211122', 'male', 'Single', 'Baptist', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 4, NULL, NULL, NULL, 1, '6229e7e2-7b97-4885-963c-b6c277229ae8', 'First', 'Full Time', '2026-10-04', NULL, '2026-10-04', '1947dc0a-1306-40ac-992b-b808f03f1651', 'Full Time', '2026-00001', NULL, NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b', '2026-10-04 18:10:04', NULL, NULL, '2026-10-04 18:09:39', '2026-10-04 18:10:04', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '0cb78bec-f840-5f54-bdeb-58593a417c0b');

-- Dumping structure for table sims.assessment_categories
CREATE TABLE IF NOT EXISTS `assessment_categories` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_subject_id)',
  `name` text NOT NULL COMMENT '''Quizzes'', ''Exams''',
  `weight` decimal(5,2) NOT NULL COMMENT 'Category weight',
  `absent_as_zero` tinyint(1) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `allow_makeup` tinyint(1) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `drop_lowest_count` smallint(6) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_offering_name` (`offering_id`,`name`) USING HASH,
  KEY `fk_assessment_categories_created_by` (`created_by`),
  KEY `fk_assessment_categories_updated_by` (`updated_by`),
  KEY `fk_categories_offering` (`offering_id`),
  CONSTRAINT `fk_assessment_categories_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessment_categories_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_categories_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `ck_categories_weight` CHECK (`weight` >= 0),
  CONSTRAINT `ck_categories_drop_nonneg` CHECK (`drop_lowest_count` is null or `drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.assessment_categories: ~0 rows (approximately)

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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.assessment_grades: ~0 rows (approximately)

-- Dumping structure for table sims.assessment_policies
CREATE TABLE IF NOT EXISTS `assessment_policies` (
  `id` smallint(6) NOT NULL DEFAULT 1 COMMENT 'PK, pinned to 1 (single-row guard)',
  `absent_as_zero` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'School default',
  `allow_makeup` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'School default',
  `drop_lowest_count` smallint(6) NOT NULL DEFAULT 0 COMMENT 'School default; drop none',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `students_can_view_grades` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'D32: when 0, students cannot reach any grade surface (403 grades_hidden). Dean-controlled. Never exposes revision state either way.',
  PRIMARY KEY (`id`),
  KEY `fk_assessment_policies_created_by` (`created_by`),
  KEY `fk_assessment_policies_updated_by` (`updated_by`),
  CONSTRAINT `fk_assessment_policies_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessment_policies_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_assessment_policies_singleton` CHECK (`id` = 1),
  CONSTRAINT `ck_assessment_policies_drop_nonneg` CHECK (`drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.assessment_policies: ~1 rows (approximately)
INSERT INTO `assessment_policies` (`id`, `absent_as_zero`, `allow_makeup`, `drop_lowest_count`, `created_at`, `updated_at`, `created_by`, `updated_by`, `students_can_view_grades`) VALUES
	(1, 1, 1, 0, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, 0);

-- Dumping structure for table sims.assessments
CREATE TABLE IF NOT EXISTS `assessments` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_subject_id)',
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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_assessments_semester` (`semester_id`),
  KEY `fk_assessments_category` (`category_id`),
  KEY `fk_assessments_created_by` (`created_by`),
  KEY `fk_assessments_updated_by` (`updated_by`),
  KEY `ix_assessments_class_subject_semester` (`semester_id`),
  KEY `fk_assessments_offering` (`offering_id`),
  CONSTRAINT `fk_assessments_category` FOREIGN KEY (`category_id`) REFERENCES `assessment_categories` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessments_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_assessments_maxscore` CHECK (`max_score` > 0),
  CONSTRAINT `ck_assessments_weight` CHECK (`weight` >= 0),
  CONSTRAINT `ck_assessments_drop_nonneg` CHECK (`drop_lowest_count` is null or `drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.assessments: ~0 rows (approximately)

-- Dumping structure for table sims.attendance_records
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_id)',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `enrollment_id` uuid NOT NULL COMMENT 'FK → class_enrollments (section provenance)',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters (summary scoping)',
  `attendance_date` date NOT NULL COMMENT 'The day',
  `status` enum('present','absent','late','excused') NOT NULL DEFAULT 'present' COMMENT 'present / absent / late / excused',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_offering_student_date` (`offering_id`,`student_id`,`attendance_date`),
  KEY `fk_attendance_enrollment` (`enrollment_id`),
  KEY `fk_attendance_semester` (`semester_id`),
  KEY `fk_attendance_created_by` (`created_by`),
  KEY `fk_attendance_updated_by` (`updated_by`),
  KEY `ix_attendance_class_date` (`attendance_date`),
  KEY `ix_attendance_student_semester` (`student_id`,`semester_id`),
  CONSTRAINT `fk_attendance_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_attendance_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `class_enrollments` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_attendance_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.attendance_records: ~0 rows (approximately)

-- Dumping structure for table sims.audit_log
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `actor_user_id` uuid DEFAULT NULL COMMENT 'FK → users (who)',
  `action` varchar(50) NOT NULL COMMENT 'e.g. ''grade.update'', ''student.deactivate',
  `entity_type` varchar(50) NOT NULL COMMENT '''assessment_grade'', ''student_profile''',
  `entity_id` uuid DEFAULT NULL COMMENT 'Affected row',
  `summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Small before/after or context blob',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `module` varchar(40) DEFAULT NULL COMMENT 'D45 §46 - the FUNCTIONAL area (Grades, Enrolment, Admissions...). Distinct from entity_type, which names a TABLE: an auditor asks "what happened in Grades", not "what happened to the assessment_grades row".',
  `ip_address` varchar(45) DEFAULT NULL COMMENT 'D45 §46, "where appropriate". 45 chars = the maximum length of an IPv6 literal. NULL for anything not raised by an HTTP request (seeds, migrations, scheduled work).',
  `previous_value` longtext DEFAULT NULL COMMENT 'D45 §46 - JSON object, the value(s) BEFORE the change. NULL on a creation.',
  `new_value` longtext DEFAULT NULL COMMENT 'D45 §46 - JSON object, the value(s) AFTER the change. NULL on a deletion.',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `k_audit_actor` (`actor_user_id`),
  KEY `ix_audit_created_at` (`created_at` DESC),
  KEY `ix_audit_module_created` (`module`,`created_at` DESC),
  KEY `ix_audit_action_created` (`action`,`created_at` DESC),
  KEY `ix_audit_actor_created` (`actor_user_id`,`created_at` DESC),
  CONSTRAINT `k_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `summary` CHECK (json_valid(`summary`))
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.audit_log: ~20 rows (approximately)
INSERT INTO `audit_log` (`id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `summary`, `created_at`, `module`, `ip_address`, `previous_value`, `new_value`) VALUES
	(1, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'academic_year.create', 'academic_year', '1947dc0a-1306-40ac-992b-b808f03f1651', '{"name": "2026-2027"}', '2026-10-04 18:02:41', 'Academic calendar', '127.0.0.1', NULL, NULL),
	(2, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.create', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', '{"name": "Turo Hernandez"}', '2026-10-04 18:06:14', 'Admissions', '127.0.0.1', NULL, NULL),
	(3, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:20', 'Admissions', '127.0.0.1', NULL, NULL),
	(4, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:25', 'Admissions', '127.0.0.1', NULL, NULL),
	(5, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:36', 'Admissions', '127.0.0.1', NULL, NULL),
	(6, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:37', 'Admissions', '127.0.0.1', NULL, NULL),
	(7, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:38', 'Admissions', '127.0.0.1', NULL, NULL),
	(8, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:54', 'Admissions', '127.0.0.1', NULL, NULL),
	(9, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:06:56', 'Admissions', '127.0.0.1', NULL, NULL),
	(10, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:07:09', 'Admissions', '127.0.0.1', NULL, NULL),
	(11, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:07:13', 'Admissions', '127.0.0.1', NULL, NULL),
	(12, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:04', 'Admissions', '127.0.0.1', NULL, NULL),
	(13, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:05', 'Admissions', '127.0.0.1', NULL, NULL),
	(14, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:06', 'Admissions', '127.0.0.1', NULL, NULL),
	(15, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:10', 'Admissions', '127.0.0.1', NULL, NULL),
	(16, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:20', 'Admissions', '127.0.0.1', NULL, NULL),
	(17, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:25', 'Admissions', '127.0.0.1', NULL, NULL),
	(18, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.update', 'application_temp', '39a796ce-d5e1-46b8-8819-1d9f5130cdfb', 'null', '2026-10-04 18:09:39', 'Admissions', '127.0.0.1', NULL, NULL),
	(19, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.pending.submit', 'application', '82eba5f6-5355-45de-abc2-2db539bf79ac', '{"name": "Turo Hernandez", "promoted_from": "39a796ce-d5e1-46b8-8819-1d9f5130cdfb", "education_rows": 0, "document_rows": 3}', '2026-10-04 18:09:39', 'Admissions', '127.0.0.1', NULL, NULL),
	(20, '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'application.accept', 'application', '82eba5f6-5355-45de-abc2-2db539bf79ac', '{"student_id": "e685e32a-e927-49fe-b861-9dee69e903f6", "student_number": "2026-00001", "program_id": "6229e7e2-7b97-4885-963c-b6c277229ae8"}', '2026-10-04 18:10:04', 'Admissions', '127.0.0.1', NULL, NULL);

-- Dumping structure for table sims.class_enrollments
CREATE TABLE IF NOT EXISTS `class_enrollments` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_id, which pointed at a HOMEROOM)',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters (term scoping)',
  `enrolled_at` datetime NOT NULL DEFAULT current_timestamp(),
  `unenrolled_at` datetime DEFAULT NULL COMMENT 'Non-null = removed (kept for history)',
  `enrollment_status` enum('pre_registered','registered','added','dropped','withdrawn','completed','failed','audit') NOT NULL DEFAULT 'registered' COMMENT 'D45 §19. `withdrawn` is ONE value - the D35 W-P / W-F split was removed by client decision 2026-09-08.',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `enroll_active_flag` tinyint(1) GENERATED ALWAYS AS (if(`unenrolled_at` is null,1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enroll_active` (`offering_id`,`student_id`,`semester_id`,`enroll_active_flag`),
  KEY `fk_enroll_student` (`student_id`),
  KEY `fk_enroll_semester` (`semester_id`),
  KEY `fk_class_enrollments_created_by` (`created_by`),
  KEY `fk_class_enrollments_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_enrollments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_enrollments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_enroll_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_enroll_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.class_enrollments: ~0 rows (approximately)

-- Dumping structure for table sims.class_meetings
CREATE TABLE IF NOT EXISTS `class_meetings` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_subject_id)',
  `day_of_week` smallint(6) NOT NULL COMMENT 'ISO weekday: 1=Mon .. 5=Fri (app.common.enums.DayOfWeek)',
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `room` text DEFAULT NULL COMMENT 'Free text, e.g. "Room A" / "Lab 1"',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_class_meetings_day_start` (`day_of_week`,`start_time`),
  KEY `fk_class_meetings_created_by` (`created_by`),
  KEY `fk_class_meetings_updated_by` (`updated_by`),
  KEY `fk_class_meetings_offering` (`offering_id`),
  CONSTRAINT `fk_class_meetings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_meetings_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_meetings_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_class_meetings_day_of_week` CHECK (`day_of_week` between 1 and 5),
  CONSTRAINT `ck_class_meetings_time_order` CHECK (`end_time` > `start_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.class_meetings: ~0 rows (approximately)

-- Dumping structure for table sims.class_teachers
CREATE TABLE IF NOT EXISTS `class_teachers` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_subject_id)',
  `teacher_id` uuid NOT NULL COMMENT 'FK → teacher_profiles',
  `is_lead` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Display marker only; does not affect edit rights',
  `assigned_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_teachers_offering_teacher` (`offering_id`,`teacher_id`),
  KEY `fk_class_teachers_teacher` (`teacher_id`),
  KEY `fk_class_teachers_created_by` (`created_by`),
  KEY `fk_class_teachers_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_teachers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_teachers_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_teachers_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teacher_profiles` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_teachers_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.class_teachers: ~0 rows (approximately)

-- Dumping structure for table sims.classroom
CREATE TABLE IF NOT EXISTS `classroom` (
  `classroomid` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `roomcode` varchar(25) NOT NULL COMMENT 'e.g. A-101. Unique among live rooms.',
  `Building` varchar(60) NOT NULL COMMENT 'Client column name, kept as dumped.',
  `Capacity` int(9) NOT NULL DEFAULT 0 COMMENT 'Seats. 0 = not recorded.',
  `room_type` varchar(150) DEFAULT NULL COMMENT 'e.g. Lecture / Lab / Computer lab. Free text.',
  `status` enum('Active','Inactive','In-Use','Available','Occupied') NOT NULL DEFAULT 'Active' COMMENT 'Client vocabulary, dumped as-is apart from spelling Available. The API writes Active/Inactive only; the rest describe live occupancy, which the timetable knows and a person should not be typing.',
  `created_by` uuid DEFAULT NULL,
  `created_on` datetime NOT NULL DEFAULT current_timestamp(),
  `edited_by` uuid DEFAULT NULL,
  `edited_on` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`classroomid`),
  UNIQUE KEY `uq_classroom_roomcode` (`roomcode`),
  KEY `fk_classroom_created_by` (`created_by`),
  KEY `fk_classroom_edited_by` (`edited_by`),
  CONSTRAINT `fk_classroom_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_classroom_edited_by` FOREIGN KEY (`edited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_classroom_capacity` CHECK (`Capacity` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='Physical rooms (D44, from the client dump sims_10).';

-- Dumping data for table sims.classroom: ~0 rows (approximately)

-- Dumping structure for table sims.course_offerings
CREATE TABLE IF NOT EXISTS `course_offerings` (
  `id` uuid NOT NULL COMMENT 'PK',
  `course_id` uuid NOT NULL COMMENT 'FK -> courses. WHAT is taught (credits live there, not here).',
  `semester_id` uuid NOT NULL COMMENT 'FK -> semesters. WHEN it is taught. Replaces classes.academic_year_id (D31).',
  `section_code` varchar(10) DEFAULT NULL COMMENT 'Parallel sections of one course in one term: 01, 02. NULL = the only section.',
  `capacity` smallint(6) DEFAULT NULL COMMENT 'Seats. NULL = uncapped.',
  `classroomid` uuid DEFAULT NULL COMMENT 'FK -> classroom. NULL = no room assigned. D44; the dump had DEFAULT uuid_v4(), which would point every existing offering at a room that does not exist.',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `active_section` varchar(10) GENERATED ALWAYS AS (if(`deleted_at` is null,coalesce(`section_code`,''),NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_offering_active` (`course_id`,`semester_id`,`active_section`),
  KEY `fk_course_offerings_semester` (`semester_id`),
  KEY `fk_course_offerings_created_by` (`created_by`),
  KEY `fk_course_offerings_updated_by` (`updated_by`),
  KEY `fk_course_offerings_classroom` (`classroomid`),
  CONSTRAINT `fk_course_offerings_classroom` FOREIGN KEY (`classroomid`) REFERENCES `classroom` (`classroomid`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_offerings_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_course_offerings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_offerings_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_course_offerings_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_course_offerings_capacity` CHECK (`capacity` is null or `capacity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='One course, one semester, one section. Absorbs classes + class_subjects (D31).';

-- Dumping data for table sims.course_offerings: ~0 rows (approximately)

-- Dumping structure for table sims.course_prerequisites
CREATE TABLE IF NOT EXISTS `course_prerequisites` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `course_id` uuid NOT NULL COMMENT 'FK -> courses (the gated course)',
  `prerequisite_course_id` uuid DEFAULT NULL COMMENT 'FK -> courses (the required course); NULL when requirement_type = all_program_courses',
  `program_id` uuid DEFAULT NULL COMMENT 'FK -> programs; NULL = applies in every programme',
  `requirement_type` enum('course','all_program_courses') NOT NULL DEFAULT 'course',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_prereq` (`course_id`,`prerequisite_course_id`,`program_id`),
  KEY `ix_course_prereq_course` (`course_id`),
  KEY `fk_course_prereq_prereq` (`prerequisite_course_id`),
  KEY `fk_course_prereq_program` (`program_id`),
  KEY `fk_course_prereq_created_by` (`created_by`),
  KEY `fk_course_prereq_updated_by` (`updated_by`),
  CONSTRAINT `fk_course_prereq_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_prereq_prereq` FOREIGN KEY (`prerequisite_course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_course_prereq_shape` CHECK (`requirement_type` = 'course' and `prerequisite_course_id` is not null or `requirement_type` = 'all_program_courses' and `prerequisite_course_id` is null),
  CONSTRAINT `ck_course_prereq_not_self` CHECK (`prerequisite_course_id` is null or `prerequisite_course_id` <> `course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.course_prerequisites: ~0 rows (approximately)

-- Dumping structure for table sims.courses
CREATE TABLE IF NOT EXISTS `courses` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `code` varchar(70) NOT NULL COMMENT 'BAJC course code, e.g. ITEC1104, BIOL1102L. Width matches subjects.code exactly so the 2a copy cannot truncate.',
  `name` varchar(200) NOT NULL COMMENT 'e.g. Introduction to Computers',
  `credits` smallint(6) NOT NULL DEFAULT 3 COMMENT 'Credit value; BAJC uses 1,2,3,4,6,9',
  `component` enum('GEC','SEC','CEC') DEFAULT NULL COMMENT 'BAJC component classification',
  `description` text DEFAULT NULL,
  `prerequisites_text` varchar(255) DEFAULT NULL COMMENT 'Raw text from the course-sequence PDF. Documentation only - validation reads course_prerequisites.',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Retire flag, distinct from soft-delete (mirrors subjects.is_active, see 003)',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `active_code` varchar(70) GENERATED ALWAYS AS (if(`deleted_at` is null,`code`,NULL)) STORED,
  `active_name` varchar(200) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courses_code` (`active_code`),
  UNIQUE KEY `uq_courses_name` (`active_name`),
  KEY `fk_courses_created_by` (`created_by`),
  KEY `fk_courses_updated_by` (`updated_by`),
  CONSTRAINT `fk_courses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_courses_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_courses_credits` CHECK (`credits` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.courses: ~0 rows (approximately)

-- Dumping structure for table sims.credit_transfer_requests
CREATE TABLE IF NOT EXISTS `credit_transfer_requests` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id` uuid NOT NULL COMMENT 'FK -> applications. Transfers are admission-time only, by policy.',
  `external_institution` varchar(250) NOT NULL,
  `external_course_code` varchar(50) DEFAULT NULL,
  `external_course_name` varchar(200) NOT NULL,
  `external_credits` smallint(6) DEFAULT NULL,
  `external_grade` varchar(15) DEFAULT NULL COMMENT 'Grade earned at the external institution',
  `target_course_id` uuid NOT NULL COMMENT 'FK -> courses; the BAJC course being claimed',
  `content_equivalency_pct` decimal(5,2) DEFAULT NULL COMMENT 'Assessed content match. Must be >= 75.00 to approve.',
  `cta_document_id` uuid DEFAULT NULL COMMENT 'FK -> application_documents (completed CTA form)',
  `transcript_document_id` uuid DEFAULT NULL COMMENT 'FK -> application_documents (original transcript)',
  `outline_document_id` uuid DEFAULT NULL COMMENT 'FK -> application_documents (course outlines)',
  `status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `decided_by_user_id` uuid DEFAULT NULL COMMENT 'FK -> users; the Dean',
  `decided_at` datetime DEFAULT NULL,
  `note` text DEFAULT NULL COMMENT 'Dean assessment of knowledge/skills equivalency',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_cta_application` (`application_id`),
  KEY `ix_cta_status` (`status`),
  KEY `fk_cta_target_course` (`target_course_id`),
  KEY `fk_cta_decided_by` (`decided_by_user_id`),
  KEY `fk_cta_cta_doc` (`cta_document_id`),
  KEY `fk_cta_transcript_doc` (`transcript_document_id`),
  KEY `fk_cta_outline_doc` (`outline_document_id`),
  KEY `fk_cta_created_by` (`created_by`),
  KEY `fk_cta_updated_by` (`updated_by`),
  CONSTRAINT `fk_cta_application` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cta_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_cta_doc` FOREIGN KEY (`cta_document_id`) REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_decided_by` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_outline_doc` FOREIGN KEY (`outline_document_id`) REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_target_course` FOREIGN KEY (`target_course_id`) REFERENCES `courses` (`id`),
  CONSTRAINT `fk_cta_transcript_doc` FOREIGN KEY (`transcript_document_id`) REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_cta_equivalency_range` CHECK (`content_equivalency_pct` is null or `content_equivalency_pct` between 0 and 100),
  CONSTRAINT `ck_cta_approval_requires_75` CHECK (`status` <> 'approved' or `content_equivalency_pct` is not null and `content_equivalency_pct` >= 75.00)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.credit_transfer_requests: ~0 rows (approximately)

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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_events_start_date` (`start_date`),
  KEY `ix_events_date_range` (`start_date`,`end_date`),
  KEY `fk_events_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_events_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_events_dates` CHECK (`end_date` is null or `end_date` >= `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.events: ~0 rows (approximately)

-- Dumping structure for table sims.grade_revision_requests
CREATE TABLE IF NOT EXISTS `grade_revision_requests` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `assessment_grade_id` uuid NOT NULL COMMENT 'FK -> assessment_grades (the cell being revised)',
  `requested_by_user_id` uuid NOT NULL COMMENT 'FK -> users (the Lecturer)',
  `reason` text NOT NULL COMMENT 'Brief §20 step 4 - description of the second assessment. Required.',
  `original_score` decimal(6,2) DEFAULT NULL COMMENT 'assessment_grades.score captured at request time',
  `proposed_score` decimal(6,2) NOT NULL COMMENT 'The new result the Lecturer recorded',
  `status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `decided_by_user_id` uuid DEFAULT NULL COMMENT 'FK -> users (the Dean)',
  `decided_at` datetime DEFAULT NULL,
  `decision_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `pending_flag` tinyint(1) GENERATED ALWAYS AS (if(`status` = 'pending',1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grade_revision_open` (`assessment_grade_id`,`pending_flag`),
  KEY `ix_grade_revision_status` (`status`),
  KEY `ix_grade_revision_requested_by` (`requested_by_user_id`),
  KEY `fk_grade_revision_decided_by` (`decided_by_user_id`),
  CONSTRAINT `fk_grade_revision_decided_by` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_grade_revision_grade` FOREIGN KEY (`assessment_grade_id`) REFERENCES `assessment_grades` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_grade_revision_requested_by` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_grade_revision_scores_nonneg` CHECK (`proposed_score` >= 0 and (`original_score` is null or `original_score` >= 0)),
  CONSTRAINT `ck_grade_revision_decided` CHECK (`status` = 'pending' or `decided_at` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.grade_revision_requests: ~0 rows (approximately)

-- Dumping structure for table sims.grading_scale_bands
CREATE TABLE IF NOT EXISTS `grading_scale_bands` (
  `id` uuid NOT NULL COMMENT 'PK',
  `grading_scale_id` uuid NOT NULL COMMENT 'FK → grading_scales',
  `letter` char(2) NOT NULL COMMENT '''A'', ''B'', …',
  `min_score` decimal(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Inclusive lower bound',
  `max_score` decimal(5,2) NOT NULL DEFAULT 100.00 COMMENT 'Inclusive upper bound',
  `grade_point` decimal(3,2) DEFAULT NULL COMMENT 'BAJC 4.00 scale, e.g. A=4.00, A-=3.75, C+=2.50. NULL until the Dean sets the scale.',
  `is_passing` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Convenience flag',
  `sort_order` smallint(6) NOT NULL COMMENT 'Display order',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bands_scale_letter` (`grading_scale_id`,`letter`),
  CONSTRAINT `fk_bands_scale` FOREIGN KEY (`grading_scale_id`) REFERENCES `grading_scales` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `ck_bands_range` CHECK (`min_score` >= 0 and `max_score` <= 100 and `min_score` <= `max_score`),
  CONSTRAINT `ck_bands_grade_point` CHECK (`grade_point` is null or `grade_point` between 0 and 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.grading_scale_bands: ~8 rows (approximately)
INSERT INTO `grading_scale_bands` (`id`, `grading_scale_id`, `letter`, `min_score`, `max_score`, `grade_point`, `is_passing`, `sort_order`, `created_at`, `updated_at`) VALUES
	('1d64f98d-456e-486d-9347-300985ff4866', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'A', 95.00, 100.00, 4.00, 1, 1, '2026-10-04 18:02:41', NULL),
	('d6a7e1df-afbd-4c55-8d04-4263b205b52d', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'C+', 75.00, 79.00, 2.50, 1, 5, '2026-10-04 18:02:41', NULL),
	('39223c00-9445-4abf-9585-686313aa326d', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'C', 70.00, 74.00, 2.00, 1, 6, '2026-10-04 18:02:41', NULL),
	('baf35490-1859-491e-aa74-7a1395b28678', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'A-', 90.00, 94.00, 3.75, 1, 2, '2026-10-04 18:02:41', NULL),
	('faf93f4e-d23a-4ff7-a473-aa7032737460', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'B+', 85.00, 89.00, 3.50, 1, 3, '2026-10-04 18:02:41', NULL),
	('0500241d-3f2e-43d4-9cc9-def98dc29c85', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'D', 65.00, 69.00, 1.00, 0, 7, '2026-10-04 18:02:41', NULL),
	('04f3df1c-aab7-48b3-808e-ea80e7accb73', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'F', 0.00, 64.00, 0.00, 0, 8, '2026-10-04 18:02:41', NULL),
	('c99baa91-3e46-4376-9be0-f20132567691', '33543d4b-9683-48b8-ba66-9e8f6f46e86c', 'B', 80.00, 84.00, 3.00, 1, 4, '2026-10-04 18:02:41', NULL);

-- Dumping structure for table sims.grading_scales
CREATE TABLE IF NOT EXISTS `grading_scales` (
  `id` uuid NOT NULL COMMENT 'PK',
  `academic_year_id` uuid NOT NULL COMMENT 'FK → academic_years (1:1)',
  `pass_mark` decimal(5,2) NOT NULL DEFAULT 60.00 COMMENT 'Pass/fail boundary',
  `is_frozen` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Set true when the year archives',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.grading_scales: ~1 rows (approximately)
INSERT INTO `grading_scales` (`id`, `academic_year_id`, `pass_mark`, `is_frozen`, `created_at`, `updated_at`, `created_by`, `updated_by`) VALUES
	('33543d4b-9683-48b8-ba66-9e8f6f46e86c', '1947dc0a-1306-40ac-992b-b808f03f1651', 70.00, 0, '2026-10-04 18:02:41', NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b', NULL);

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

-- Dumping data for table sims.login_attempts: ~1 rows (approximately)
INSERT INTO `login_attempts` (`id`, `email_attempted`, `user_id`, `succeeded`, `ip_address`, `attempted_at`) VALUES
	('0d9dcb1b-d29d-42cb-9674-451fe59610d2', 'principal', '0cb78bec-f840-5f54-bdeb-58593a417c0b', 1, '::ffff:127.0.0.1', '2026-10-04 17:57:52');

-- Dumping structure for table sims.number_sequences
CREATE TABLE IF NOT EXISTS `number_sequences` (
  `scope` varchar(20) NOT NULL COMMENT 'What is being numbered: `student` | `application`. `student_ym` is the retired pre-D44 YYYYMM namespace, kept for provenance and never allocated from.',
  `seq_key` varchar(10) NOT NULL COMMENT 'The bucket the counter resets in - `2026` for both live scopes. varchar because the retired scope keys are YYYYMM and a future scope may not be year-shaped.',
  `last_seq` int(11) NOT NULL DEFAULT 0 COMMENT 'Highest sequence issued for this (scope, key).',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`scope`,`seq_key`),
  CONSTRAINT `ck_number_sequences_nonneg` CHECK (`last_seq` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='Row-locked counters behind the generated human IDs (D44). Replaces student_number_sequences.';

-- Dumping data for table sims.number_sequences: ~2 rows (approximately)
INSERT INTO `number_sequences` (`scope`, `seq_key`, `last_seq`, `created_at`, `updated_at`) VALUES
	('application', '2026', 1, '2026-10-04 18:09:39', '2026-10-04 18:09:39'),
	('student', '2026', 1, '2026-10-04 18:10:04', '2026-10-04 18:10:04');

-- Dumping structure for table sims.password_reset_tokens
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` uuid NOT NULL COMMENT 'PK',
  `user_id` uuid NOT NULL COMMENT 'FK → users',
  `token_hash` text NOT NULL COMMENT 'SHA-256 of the one-time token',
  `expires_at` datetime NOT NULL COMMENT 'Short-lived',
  `used_at` datetime DEFAULT NULL COMMENT 'Non-null = consumed (single-use)',
  `created_by` uuid DEFAULT NULL COMMENT 'The admin who initiated',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pwreset_token_hash` (`token_hash`) USING HASH,
  KEY `fk_pwreset_user` (`user_id`),
  KEY `fk_pwreset_creator` (`created_by`),
  CONSTRAINT `fk_pwreset_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_pwreset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.password_reset_tokens: ~0 rows (approximately)

-- Dumping structure for table sims.program_courses
CREATE TABLE IF NOT EXISTS `program_courses` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `program_id` uuid NOT NULL COMMENT 'FK -> programs',
  `course_id` uuid NOT NULL COMMENT 'FK -> courses',
  `term_label` varchar(50) NOT NULL COMMENT 'Curriculum position, e.g. "Summer 1", "Semester 3", "Spring 2"',
  `term_order` smallint(6) NOT NULL COMMENT 'Display/sequence order of the block within the programme (1-based)',
  `is_required` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_program_courses` (`program_id`,`course_id`),
  KEY `ix_program_courses_program_order` (`program_id`,`term_order`),
  KEY `fk_program_courses_course` (`course_id`),
  KEY `fk_program_courses_created_by` (`created_by`),
  KEY `fk_program_courses_updated_by` (`updated_by`),
  CONSTRAINT `fk_program_courses_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`),
  CONSTRAINT `fk_program_courses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_program_courses_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_courses_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_program_courses_term_order` CHECK (`term_order` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.program_courses: ~0 rows (approximately)

-- Dumping structure for table sims.program_heads
CREATE TABLE IF NOT EXISTS `program_heads` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `program_id` uuid NOT NULL COMMENT 'FK -> programs. The unit being headed.',
  `teacher_id` uuid NOT NULL COMMENT 'FK -> teacher_profiles. The lecturer heading it.',
  `appointed_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT 'When the appointment took effect. Display/audit only - scope is not time-sliced.',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp() COMMENT 'NULL until edited - the 015 convention.',
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_program_heads` (`program_id`,`teacher_id`),
  KEY `ix_program_heads_teacher` (`teacher_id`),
  KEY `fk_program_heads_created_by` (`created_by`),
  KEY `fk_program_heads_updated_by` (`updated_by`),
  CONSTRAINT `fk_program_heads_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_program_heads_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_heads_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teacher_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_heads_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='Head of Department appointments: lecturer <-> programme, many-to-many (D43).';

-- Dumping data for table sims.program_heads: ~0 rows (approximately)

-- Dumping structure for table sims.programs
CREATE TABLE IF NOT EXISTS `programs` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `code` varchar(10) NOT NULL COMMENT 'e.g. BMAD - printed on the semester report',
  `name` varchar(250) NOT NULL COMMENT 'e.g. Business Management',
  `award` varchar(100) DEFAULT NULL COMMENT 'e.g. Associate of Social Science',
  `admission_requirements` text DEFAULT NULL COMMENT 'What an applicant needs to get in. Prose, not rules (D44; widened D45 §9).',
  `graduation_requirements` text DEFAULT NULL COMMENT 'What a student needs to finish. Prose, not rules (D44; widened D45 §9).',
  `head_of_department` varchar(150) DEFAULT NULL COMMENT 'D45 §8. Displayed head. The authoritative link stays `program_heads`.',
  `office_information` text DEFAULT NULL COMMENT 'D45 §8 - office location / hours / contact. Free text (client, 2026-09-08).',
  `total_credits` smallint(6) DEFAULT NULL COMMENT 'Total Programme Credits from the sequence PDF (86-102)',
  `min_passing_grade_point` decimal(3,2) NOT NULL DEFAULT 2.50 COMMENT 'Programme pass mark as a grade point. 2.50 = C+ (all programmes); Primary Education is set to 2.00 = C.',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `comments` text DEFAULT NULL COMMENT 'D44, from the client dump. Free-text notes on the programme. Dump had varchar(500) NOT NULL DEFAULT ''1''; that default is a stray test value.',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `active_code` varchar(10) GENERATED ALWAYS AS (if(`deleted_at` is null,`code`,NULL)) STORED,
  `active_name` varchar(250) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_programs_code` (`active_code`),
  UNIQUE KEY `uq_programs_name` (`active_name`),
  KEY `fk_programs_created_by` (`created_by`),
  KEY `fk_programs_updated_by` (`updated_by`),
  CONSTRAINT `fk_programs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_programs_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_programs_pass_gp` CHECK (`min_passing_grade_point` between 0 and 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.programs: ~9 rows (approximately)
INSERT INTO `programs` (`id`, `code`, `name`, `award`, `admission_requirements`, `graduation_requirements`, `head_of_department`, `office_information`, `total_credits`, `min_passing_grade_point`, `is_active`, `comments`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`) VALUES
	('bc3287e0-14cb-461d-9d8c-2dbb23592bb1', 'BIOL', 'Biology', 'Associate of Science', NULL, NULL, NULL, NULL, 88, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-24 22:31:33', NULL, NULL),
	('0f7e8bdf-44bd-45bf-b56d-3ec386fa3cb4', 'GNST', 'General Studies', 'Associate of Social Science', NULL, NULL, NULL, NULL, 87, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-17 03:35:31', NULL, NULL),
	('22a02920-dc1e-4572-9da3-4ee738f8f42f', 'EDUC', 'Primary Education', 'Associate of Arts', NULL, NULL, NULL, NULL, 102, 2.00, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-17 03:35:31', NULL, NULL),
	('7983a1a7-d9cd-4d7f-a840-64351795ba54', 'ITEC', 'Information Technology', 'Associate of Science', NULL, NULL, NULL, NULL, 90, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-17 03:35:31', NULL, NULL),
	('aa9d3b21-19b5-4938-9e43-9c7fbafa9eda', 'BMAD', 'Business Management', 'Associate of Social Science', NULL, NULL, NULL, NULL, 87, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-25 05:22:42', NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b'),
	('72d40672-f70d-40ef-833d-9d49e44faeb1', 'RELG', 'Religion', 'Associate of Arts', NULL, NULL, NULL, NULL, 86, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-17 03:35:31', NULL, NULL),
	('c36f18d9-581c-404c-9794-9fac31d36cbe', 'ICTS', 'Information Tech', NULL, NULL, NULL, NULL, NULL, 87, 2.50, 1, NULL, NULL, '2026-08-28 03:00:29', '2026-08-28 03:00:44', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '0cb78bec-f840-5f54-bdeb-58593a417c0b'),
	('6229e7e2-7b97-4885-963c-b6c277229ae8', 'AGRI', 'Applied Agriculture', 'Associate of Science', NULL, NULL, NULL, NULL, 86, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-28 15:51:54', NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b'),
	('c32f920e-1d87-4dcf-b916-d59afc647dee', 'MATH', 'Mathematics', 'Associate of Science', NULL, NULL, NULL, NULL, 87, 2.50, 1, NULL, NULL, '2026-08-17 03:35:31', '2026-08-17 03:35:31', NULL, NULL);

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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_sessions_token_hash` (`token_hash`),
  KEY `fk_refresh_sessions_user` (`user_id`),
  CONSTRAINT `fk_refresh_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.refresh_sessions: ~9 rows (approximately)
INSERT INTO `refresh_sessions` (`id`, `user_id`, `token_hash`, `issued_at`, `last_used_at`, `expires_at`, `is_revoked`, `revoked_at`, `user_agent`, `ip_address`, `created_at`, `updated_at`) VALUES
	('3b7c40a0-23ff-43c7-9acb-093ae9ce941b', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '684a7d0e3726480002f85c94a0789593143eabcf359c45e12b97cd65e67bbf6b', '2026-10-04 17:58:47', '2026-10-04 17:58:47', '2026-10-11 17:58:47', 1, '2026-10-04 18:01:16', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 17:58:47', '2026-10-04 18:01:16'),
	('f19ee56c-713e-4aba-b8b5-48e54d41a70e', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '9bcafc1662a8fd1c86d16714b57f3070315b5d35676a2fc0bd78192ea6e92b1c', '2026-10-04 18:05:35', '2026-10-04 18:05:35', '2026-10-11 18:05:35', 1, '2026-10-04 18:06:45', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:05:35', '2026-10-04 18:06:45'),
	('e49e4c53-24bf-4c98-88f0-4bd427e74415', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '2be985612356b4b155d071d4b31e86902e8551e74c1d18661555d1ab9d8e02bc', '2026-10-04 17:57:52', '2026-10-04 17:57:52', '2026-10-11 17:57:52', 1, '2026-10-04 17:58:47', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 17:57:52', '2026-10-04 17:58:47'),
	('baae8653-0c38-4184-9980-61b72c79ef30', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '030a9d39c7a0c3e88369ebd4163f554d5bbc4851ecfac65e9b59b9a5e4ee39fa', '2026-10-04 18:06:45', '2026-10-04 18:06:45', '2026-10-11 18:06:45', 1, '2026-10-04 18:08:50', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:06:45', '2026-10-04 18:08:50'),
	('b0232166-b303-4b9f-af67-6689c87924b6', '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'f0015dc63354288d32300df6e0d4c4386c38f4420fffebfa90b32a631c169cfb', '2026-10-04 18:10:14', '2026-10-04 18:10:14', '2026-10-11 18:10:14', 1, '2026-10-04 18:21:13', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:10:14', '2026-10-04 18:21:13'),
	('7625af3d-0958-481f-bbd7-6bfd756ea238', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '31c39baa07d0d0207f2483833ceda4c30f2e3589ed5fcfa80ac2f223ca5c74ea', '2026-10-04 18:01:16', '2026-10-04 18:01:16', '2026-10-11 18:01:16', 1, '2026-10-04 18:02:44', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:01:16', '2026-10-04 18:02:44'),
	('5676665a-7e31-4645-8d93-711231ee9923', '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'e7c3dc88a67aede0f265ccf63b89d4f7a4914ed91d78b1cc22ac9bdb48c87f38', '2026-10-04 18:02:44', '2026-10-04 18:02:44', '2026-10-11 18:02:44', 1, '2026-10-04 18:03:46', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:02:44', '2026-10-04 18:03:46'),
	('2169db56-b54e-482b-a61e-e6c898ffe098', '0cb78bec-f840-5f54-bdeb-58593a417c0b', 'a6b532be6d8fea6e6c8af6041b7d4d8402fd3cf4cf3231c139026cfbd491a621', '2026-10-04 18:03:46', '2026-10-04 18:03:46', '2026-10-11 18:03:46', 1, '2026-10-04 18:05:35', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:03:46', '2026-10-04 18:05:35'),
	('867d2fcc-0829-4643-bb09-e972f9b93e1d', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '9dd45ae6408228c0aa46b84a51b8b3ccccde4d8384fe1491d395d49f3706e95e', '2026-10-04 18:08:50', '2026-10-04 18:08:50', '2026-10-11 18:08:50', 1, '2026-10-04 18:10:14', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', '::ffff:127.0.0.1', '2026-10-04 18:08:50', '2026-10-04 18:10:14');

-- Dumping structure for table sims.religions
CREATE TABLE IF NOT EXISTS `religions` (
  `id` int(9) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `code_name` varchar(10) DEFAULT NULL,
  `createdon` datetime NOT NULL,
  `createdby` varchar(50) NOT NULL,
  `editedby` varchar(50) DEFAULT NULL,
  `editedon` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='D39 (Meeting #2 item 8). Read-only vocabulary for the Religion dropdown. Client-owned; NOT referenced by a FK - student_profiles.religion stays free text.';

-- Dumping data for table sims.religions: ~8 rows (approximately)
INSERT INTO `religions` (`id`, `name`, `code_name`, `createdon`, `createdby`, `editedby`, `editedon`) VALUES
	(1, 'Seventh Day Adventist', 'SDA', '2026-08-24 18:59:48', 'admin', NULL, NULL),
	(2, 'Catholic', 'CATH', '2026-08-24 19:00:26', 'admin', NULL, NULL),
	(3, 'Baptist', 'BAP', '2026-08-31 22:05:25', 'admin', NULL, NULL),
	(4, 'Methodist', 'MTH', '2026-08-31 22:06:27', 'admin', NULL, NULL),
	(5, 'Pentecostal', 'PEN', '2026-08-31 22:07:42', 'admin', NULL, NULL),
	(6, 'Presbiterian', 'PRES', '2026-08-31 22:08:17', 'admin', NULL, NULL),
	(7, 'Jehova Witness', 'JW', '2026-08-31 22:09:02', 'admin', NULL, NULL),
	(8, 'None', 'NA', '2026-08-31 22:09:35', 'admin', NULL, NULL);

-- Dumping structure for table sims.report_card_snapshots
CREATE TABLE IF NOT EXISTS `report_card_snapshots` (
  `id` uuid NOT NULL COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters',
  `kind` enum('midterm','endterm') NOT NULL DEFAULT 'endterm' COMMENT 'D32: which report this payload is. midterm = frozen at the mid-term window close; endterm = frozen at year archival.',
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Fully-rendered report card' CHECK (json_valid(`payload`)),
  `storage_key` text DEFAULT NULL COMMENT 'Optional pointer to a generated PDF',
  `frozen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_card_snapshot` (`student_id`,`semester_id`,`kind`),
  KEY `fk_report_card_semester` (`semester_id`),
  CONSTRAINT `fk_report_card_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_report_card_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.report_card_snapshots: ~0 rows (approximately)

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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `post_graduation_access_days` smallint(6) DEFAULT 90 COMMENT 'D39 (Meeting #2 item 6). Days a graduated student keeps grade/online access, counted from graduation_date. NULL = never expires; 0 = access ends on graduation day. Default 90 = the client''s recommended 3 months.',
  `attendance_alert_threshold` decimal(5,2) NOT NULL DEFAULT 80.00 COMMENT 'Attendance % at or below which a student or class is flagged (D45 §23).',
  PRIMARY KEY (`id`),
  KEY `fk_school_profile_created_by` (`created_by`),
  KEY `fk_school_profile_updated_by` (`updated_by`),
  CONSTRAINT `fk_school_profile_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_school_profile_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_school_profile_singleton` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.school_profile: ~1 rows (approximately)
INSERT INTO `school_profile` (`id`, `name`, `logo_storage_key`, `address`, `contact_email`, `contact_phone`, `color_primary`, `color_secondary`, `created_at`, `updated_at`, `created_by`, `updated_by`, `post_graduation_access_days`, `attendance_alert_threshold`) VALUES
	(1, 'Belize Adventist Junior College', '/logo.jpeg', 'Corozal Town, Corozal District, Belize', 'office@bajc.edu.bz', '+501-422-2015', '#1E3A6E', '#C21F30', '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, 90, 80.00);

-- Dumping structure for table sims.semesters
CREATE TABLE IF NOT EXISTS `semesters` (
  `id` uuid NOT NULL COMMENT 'PK',
  `academic_year_id` uuid NOT NULL COMMENT 'FK → academic_years',
  `name` varchar(200) NOT NULL COMMENT 'e.g. ''Fall'', ''Spring''',
  `term_type` enum('summer','semester','spring','independent') NOT NULL DEFAULT 'semester' COMMENT 'BAJC term kind. Curriculum position lives on program_courses.term_label, not here. D44 appended `independent` (independent study).',
  `sequence` smallint(6) NOT NULL COMMENT 'Order within the academic year (1-based). No longer capped at 2 - D30.',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `semester_status` enum('planning','registration_open','active','grade_submission','closed','archived') NOT NULL DEFAULT 'active' COMMENT 'D44, from the client dump. STORAGE ONLY - no API reads or writes it; `is_active` is still what decides the current term. Dump had `grade submission` with a space; snake_cased to match every other enum here.',
  `grade_submission_deadline` datetime DEFAULT NULL COMMENT 'END-TERM grade-entry cutoff (D32-1; was the only cutoff before D32). Enforced as 409 grade_window_closed in grades/service.upsert_grades.',
  `midterm_submission_start` datetime DEFAULT NULL COMMENT 'D32: mid-term grading period opens. NULL = this term has no mid-term period.',
  `midterm_submission_end` datetime DEFAULT NULL COMMENT 'D32: mid-term grading period closes. Revisions unlock and the mid-term report card can be frozen once this has passed.',
  `is_active` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Exactly one true globally',
  `active_unique_helper` int(11) GENERATED ALWAYS AS (if(`is_active` = 1,1,NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_semesters_year_seq` (`academic_year_id`,`sequence`),
  UNIQUE KEY `uq_semesters_one_active` (`active_unique_helper`),
  CONSTRAINT `fk_semesters_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `ck_semesters_dates` CHECK (`end_date` > `start_date`),
  CONSTRAINT `ck_semesters_midterm_window` CHECK (`midterm_submission_start` is null and `midterm_submission_end` is null or `midterm_submission_start` is not null and `midterm_submission_end` is not null and `midterm_submission_end` > `midterm_submission_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.semesters: ~1 rows (approximately)
INSERT INTO `semesters` (`id`, `academic_year_id`, `name`, `term_type`, `sequence`, `start_date`, `end_date`, `semester_status`, `grade_submission_deadline`, `midterm_submission_start`, `midterm_submission_end`, `is_active`, `created_at`, `updated_at`) VALUES
	('d2facfd9-465b-4a0a-99d2-fc743db67671', '1947dc0a-1306-40ac-992b-b808f03f1651', 'Summer', 'summer', 1, '2026-08-15', '2026-12-19', 'active', NULL, NULL, NULL, 1, '2026-10-04 18:02:41', NULL);

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
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.student_documents: ~0 rows (approximately)

-- Dumping structure for table sims.student_number_sequences
CREATE TABLE IF NOT EXISTS `student_number_sequences` (
  `year_month` char(6) NOT NULL COMMENT 'YYYYMM, e.g. 202608',
  `last_seq` int(11) NOT NULL DEFAULT 0 COMMENT 'Highest ### issued for this year/month',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`year_month`),
  CONSTRAINT `ck_student_number_seq_nonneg` CHECK (`last_seq` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.student_number_sequences: ~0 rows (approximately)

-- Dumping structure for table sims.student_profiles
CREATE TABLE IF NOT EXISTS `student_profiles` (
  `id` uuid NOT NULL COMMENT 'PK (surrogate)',
  `user_id` uuid DEFAULT NULL COMMENT 'FK -> users; the login this student is (nullable)',
  `student_number` text NOT NULL COMMENT 'Human student ID e.g. ''S1012'' (unique)',
  `student_id_original` int(8) DEFAULT NULL COMMENT 'D34 (client dump: studentid_original). The student ID this record carried in the system it was imported from; NULL for anyone registered here.',
  `firstname` varchar(50) DEFAULT NULL COMMENT 'Given name. NULL only for legacy single-token names; the API requires it.',
  `middlename` varchar(50) DEFAULT NULL,
  `lastname` varchar(50) NOT NULL COMMENT 'Family name. Listings sort on (lastname, firstname) - D30 §D10.',
  `date_of_birth` date NOT NULL,
  `ssno` varchar(9) DEFAULT NULL COMMENT 'Social Security No.',
  `gender` varchar(25) DEFAULT NULL COMMENT 'Free/lookup text; not a fixed enum',
  `religion` varchar(100) DEFAULT NULL,
  `civil_status` varchar(50) DEFAULT NULL COMMENT 'Form: "Civic Status"',
  `enrollment_date` date NOT NULL,
  `status` enum('Applicant','Accepted','Active','Inactive','Suspended','Withdrawn','Dropout','Completed','Graduated','Alumni','Transferred') NOT NULL DEFAULT 'Active' COMMENT 'D45 §7.5. Ten from the blueprint; `Transferred` is an eleventh kept by client decision 2026-09-08.',
  `guardian_name` text DEFAULT NULL COMMENT 'Parent/guardian contact',
  `guardian_phone` text DEFAULT NULL,
  `guardian_email` varchar(254) DEFAULT NULL,
  `mother_name` varchar(200) DEFAULT NULL,
  `father_name` varchar(200) DEFAULT NULL,
  `nok_name` varchar(200) DEFAULT NULL COMMENT 'Next of kin for emergencies',
  `nok_relationship` varchar(100) DEFAULT NULL,
  `nok_phone` varchar(50) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `street` varchar(200) DEFAULT NULL,
  `city_town_village` varchar(200) DEFAULT NULL COMMENT 'Form: Village, Town, or City',
  `district` enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') DEFAULT NULL,
  `phone` text DEFAULT NULL,
  `email` varchar(254) DEFAULT NULL COMMENT 'D34. The student''s own email address, independent of any login on `users`. NOT the login: see users.email for that.',
  `transferred_from` varchar(250) DEFAULT NULL COMMENT 'D34 (client dump: transferedfrom). The institution a transfer student came from. Free text.',
  `graduation_date` date DEFAULT NULL COMMENT 'D34 (client dump: graduationdate). Set when status becomes `graduated`. NULL for everyone else.',
  `dropout_date` datetime DEFAULT NULL COMMENT 'D34 (client dump: dropoutdate). Set when status becomes `DropOut`. NULL for everyone else.',
  `dropout_reason` varchar(250) DEFAULT NULL COMMENT 'D34 (client dump: dropoutreason). Why the student left. Free text.',
  `comments` text DEFAULT NULL COMMENT 'D34. Registrar''s free-text notes on the record. Not shown to the student.',
  `origin` varchar(50) DEFAULT NULL COMMENT 'D34. Where this record came from (e.g. an import batch, a migration, `admissions`). Free text.',
  `educationbg_id` uuid DEFAULT NULL COMMENT 'D34 (client dump). Client-requested. NO FK: there is no student-level education table - prior education is application-scoped via application_education. Unused by the API.',
  `doc_id` int(11) DEFAULT NULL COMMENT 'D34 (client dump). Client-requested. NO FK: student_documents.id is uuid, not int, and documents are 1:N via student_documents.student_id. Unused by the API.',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `is_active_number` varchar(50) GENERATED ALWAYS AS (if(`deleted_at` is null,`student_number`,NULL)) VIRTUAL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `has_health_condition` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Form: health or learning condition we should know about',
  `health_condition_note` text DEFAULT NULL,
  `atlib_exam` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Form Section B: ATLIB Exam taken',
  `num_csec` smallint(6) DEFAULT NULL COMMENT 'Form Section B: Number of CSEC Exams (1-8+)',
  `finance_name` varchar(200) DEFAULT NULL COMMENT 'Who will finance the study',
  `finance_phone` varchar(50) DEFAULT NULL,
  `finance_email` varchar(254) DEFAULT NULL,
  `program_id` uuid DEFAULT NULL COMMENT 'FK -> programs (proper uuid FK, D30)',
  `year_of_study` enum('First','Second') DEFAULT NULL COMMENT 'Form Section E: year of study applying for',
  `enrollment_load` enum('Part Time','Full Time','Transient','Summer') DEFAULT NULL COMMENT 'Study load (D30 §D11). D34 added Summer from the client dump''s yearofstudy enum.',
  `application_id` uuid DEFAULT NULL COMMENT 'FK -> applications; the application this student was admitted from',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_profiles_user` (`user_id`),
  UNIQUE KEY `uq_student_profiles_number` (`is_active_number`),
  KEY `fk_student_profiles_created_by` (`created_by`),
  KEY `fk_student_profiles_updated_by` (`updated_by`),
  KEY `fk_student_profiles_program` (`program_id`),
  KEY `fk_student_profiles_application` (`application_id`),
  KEY `ix_student_profiles_lastname` (`lastname`,`firstname`),
  CONSTRAINT `fk_student_profiles_application` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_student_profiles_num_csec` CHECK (`num_csec` is null or `num_csec` between 0 and 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.student_profiles: ~0 rows (approximately)

-- Dumping structure for table sims.student_program_history
CREATE TABLE IF NOT EXISTS `student_program_history` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK -> student_profiles',
  `program_id` uuid NOT NULL COMMENT 'FK -> programs',
  `started_at` date NOT NULL,
  `ended_at` date DEFAULT NULL COMMENT 'NULL = the student is currently in this programme',
  `reason` varchar(255) DEFAULT NULL COMMENT 'Why the programme changed',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `open_flag` tinyint(1) GENERATED ALWAYS AS (if(`ended_at` is null,1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_program_open` (`student_id`,`open_flag`),
  KEY `ix_student_program_student` (`student_id`),
  KEY `fk_student_program_program` (`program_id`),
  KEY `fk_student_program_created_by` (`created_by`),
  KEY `fk_student_program_updated_by` (`updated_by`),
  CONSTRAINT `fk_student_program_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_program_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`),
  CONSTRAINT `fk_student_program_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_student_program_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_student_program_dates` CHECK (`ended_at` is null or `ended_at` >= `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.student_program_history: ~0 rows (approximately)

-- Dumping structure for table sims.teacher_profiles
CREATE TABLE IF NOT EXISTS `teacher_profiles` (
  `id` uuid NOT NULL COMMENT 'PK',
  `user_id` uuid DEFAULT NULL COMMENT 'FK → users; the login this teacher is',
  `staff_number` text NOT NULL COMMENT 'Human staff ID (unique)',
  `full_name` varchar(250) NOT NULL,
  `first_name` varchar(250) DEFAULT NULL COMMENT 'D39. Backfilled from full_name in §3. Teachers kept a single full_name where students were split by 007; the client dump splits them, and a register sorted by surname needs the parts.',
  `last_name` varchar(250) DEFAULT NULL COMMENT 'D39. Backfilled from full_name in §3.',
  `ssno` varchar(9) DEFAULT NULL COMMENT 'D39 (Meeting #2 item 10, "ss#"). Belize social security number. Same width as student_profiles.ssno.',
  `email` varchar(254) DEFAULT NULL COMMENT 'Contact; login email lives on users',
  `licensenum` varchar(15) DEFAULT NULL COMMENT 'D39 (Meeting #2 item 10, "TeacherLicense#"). ALPHANUMERIC - the sample is OWD-2019-00035, so this is never an integer.',
  `phone` text DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL COMMENT 'active / inactive',
  `is_employed` tinyint(1) DEFAULT NULL COMMENT 'D39 (Meeting #2 item 10, "change IsPresent to IsEmployed"). Backfilled from status in §4. `status` remains what the application filters on; this mirrors it for the client''s own reports.',
  `hire_date` datetime DEFAULT NULL COMMENT 'D39. NULL default, not current_timestamp() as the dump has it - defaulting to now would assert every existing lecturer was hired the day this migration ran.',
  `end_date` datetime DEFAULT NULL COMMENT 'D39. NULL while employed. Same reasoning as hire_date on the default.',
  `subject_specializations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Postgres array of subject labels (GIN-indexed)' CHECK (json_valid(`subject_specializations`)),
  `deleted_at` datetime DEFAULT NULL,
  `is_active` int(11) GENERATED ALWAYS AS (if(`deleted_at` is null,1,NULL)) VIRTUAL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `avatar_url` varchar(500) DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `gender` enum('male','female','other') DEFAULT NULL,
  `academic_qualification` varchar(255) DEFAULT NULL COMMENT 'D39 (Meeting #2 item 10, "change column Degree/Education to Academic Qualification"). Renamed from `education`; width kept at 255 because four live values are 31 chars and the client dump''s varchar(30) had already truncated them.',
  `designation` varchar(150) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `expertise` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'JSON array of {area, level} (DemoTeacher.expertise)',
  `comments` varchar(500) DEFAULT NULL COMMENT 'D39. Free-text staff note.',
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

-- Dumping data for table sims.teacher_profiles: ~0 rows (approximately)

-- Dumping structure for table sims.term_grade_snapshots
CREATE TABLE IF NOT EXISTS `term_grade_snapshots` (
  `id` uuid NOT NULL COMMENT 'PK',
  `offering_id` uuid NOT NULL COMMENT 'FK -> course_offerings (D31; was class_subject_id)',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters',
  `subject_id` uuid NOT NULL COMMENT 'Frozen course identity at freeze time. FK -> courses (D30).',
  `numeric_grade` decimal(6,2) NOT NULL COMMENT 'Frozen weighted term grade',
  `letter_grade` varchar(15) NOT NULL COMMENT 'Frozen derived letter (scale at freeze)',
  `grade_point` decimal(3,2) DEFAULT NULL COMMENT 'Frozen grade point for letter_grade under the scale in force at freeze',
  `credits` smallint(6) DEFAULT NULL COMMENT 'Frozen course credits at freeze - a later catalog edit must not alter an issued transcript',
  `quality_points` decimal(6,2) DEFAULT NULL COMMENT 'Frozen grade_point x credits',
  `weight_base_used` decimal(6,2) DEFAULT NULL COMMENT 'Denominator after exempt/excused/pending removal',
  `effective_policy` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Resolved grading policy in force at freeze' CHECK (json_valid(`effective_policy`)),
  `frozen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_term_snapshot` (`student_id`,`offering_id`,`semester_id`),
  KEY `fk_term_snapshot_semester` (`semester_id`),
  KEY `ix_term_snapshot_student` (`student_id`),
  KEY `fk_term_snapshot_course` (`subject_id`),
  KEY `fk_term_snapshot_offering` (`offering_id`),
  CONSTRAINT `fk_term_snapshot_course` FOREIGN KEY (`subject_id`) REFERENCES `courses` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_offering` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.term_grade_snapshots: ~0 rows (approximately)

-- Dumping structure for table sims.user_preferences
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `user_id` uuid NOT NULL COMMENT 'PK and FK → users',
  `locale` text NOT NULL DEFAULT 'en' COMMENT 'locale code',
  `theme` text NOT NULL DEFAULT 'light' COMMENT 'v1 light only; column ready for dark',
  `date_format` text DEFAULT NULL COMMENT 'Optional override',
  `default_page_size` smallint(6) NOT NULL DEFAULT 25 COMMENT 'List density preference',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_preferences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `ck_user_preferences_page_size` CHECK (`default_page_size` between 5 and 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Dumping data for table sims.user_preferences: ~0 rows (approximately)

-- Dumping structure for table sims.users
CREATE TABLE IF NOT EXISTS `users` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Login identifier; case-insensitive unique',
  `username` varchar(100) DEFAULT NULL COMMENT 'Optional alternate login',
  `password_hash` text NOT NULL COMMENT 'Argon2id hash only; never plaintext',
  `role` enum('principal','secretary','teacher','student','hod','auditor','sysadmin') NOT NULL COMMENT 'principal / secretary / teacher / student / hod / auditor / sysadmin. D44 appended sysadmin as STORAGE ONLY - app.common.enums.Role has no member for it and no route accepts it.',
  `full_name` varchar(200) NOT NULL COMMENT 'Display name',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Disabled accounts cannot log in',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Forces change on first login / admin reset',
  `failed_login_count` smallint(6) NOT NULL DEFAULT 0 COMMENT 'Brute-force throttle',
  `locked_until` datetime DEFAULT NULL COMMENT 'Non-null = temporarily locked',
  `last_login_at` datetime DEFAULT NULL COMMENT 'informational',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `active_username` varchar(255) GENERATED ALWAYS AS (if(`deleted_at` is null,`username`,NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.users: ~2 rows (approximately)
INSERT INTO `users` (`id`, `email`, `username`, `password_hash`, `role`, `full_name`, `is_active`, `must_change_password`, `failed_login_count`, `locked_until`, `last_login_at`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`) VALUES
	('57eb7c25-18b2-5789-a329-39a99e277c9a', 'alicia.cano@belmopancomp.edu.bz', 'alicia.cano', '$argon2id$v=19$m=65536,t=3,p=4$fP6f/MmEx2KA5Wee52ytTg$uA8G/+R6Aqb70HsZ6H0sXReoLWKTT8JtU8WVVZqGqX8', 'teacher', 'Alicia Cano', 1, 1, 0, NULL, '2025-10-10 07:50:00', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL),
	('0cb78bec-f840-5f54-bdeb-58593a417c0b', 'principal@belmopancomp.edu.bz', 'principal', '$argon2id$v=19$m=65536,t=3,p=4$QngY0FxcNt+K6Y68YPznwQ$Ox+ZvVugMy/qmb6aKJGbbFLu556roVgjw4IIADgA7Po', 'principal', 'Alicia Mendez', 1, 0, 0, NULL, '2026-10-04 17:57:52', NULL, '2026-08-20 08:24:23', '2026-10-04 17:57:52', NULL, NULL);

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;

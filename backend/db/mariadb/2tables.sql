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

-- Dumping structure for table sims.student_profile_temp
CREATE TABLE IF NOT EXISTS `student_profile_temp` (
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
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
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

-- Dumping data for table sims.student_profile_temp: ~0 rows (approximately)

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

-- Dumping data for table sims.teacher_profiles: ~13 rows (approximately)
INSERT INTO `teacher_profiles` (`id`, `user_id`, `staff_number`, `full_name`, `email`, `phone`, `status`, `subject_specializations`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `avatar_url`, `bio`, `gender`, `education`, `designation`, `address`, `expertise`) VALUES
	('7f9e0349-b8cc-5845-9184-063d003c3831', 'd87e12d7-7c17-56b1-9b31-b3afa9e57f26', 'T-1001', 'Maria Reyes', 'maria.reyes@belmopancomp.edu.bz', '+501-6792782', 'active', '["Intermediate Algebra", "Pre-Calculus"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Head of Department with 12 years of lecture-room experience teaching Intermediate Algebra. Committed to student-centred learning and measurable outcomes.', 'female', 'M.Ed. Intermediate Algebra', 'Head of Department', '11 Ring Road, Belmopan, Cayo', '[{"area": "Intermediate Algebra", "level": 94}, {"area": "Pre-Calculus", "level": 63}]'),
	('5274aa7b-f1d9-51c0-ab78-1ed17134fd26', 'ead1c01b-c10d-514c-92d4-88045472a984', 'T-1010', 'Marlon Pou', 'marlon.pou@belmopancomp.edu.bz', '+501-6954568', 'active', '["Business Management", "Intermediate Algebra"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Senior Lecturer with 11 years of lecture-room experience teaching Business Management. Committed to student-centred learning and measurable outcomes.', 'male', 'M.Sc. Business Management', 'Senior Lecturer', '28 Forest Drive, Belmopan, Cayo', '[{"area": "Business Management", "level": 88}, {"area": "Intermediate Algebra", "level": 80}]'),
	('e50067bd-37b7-5a22-85f4-2164dfd201f2', '57eb7c25-18b2-5789-a329-39a99e277c9a', 'T-1003', 'Alicia Cano', 'alicia.cano@belmopancomp.edu.bz', '+501-6604312', 'active', '["Foundations of Biology", "Fundamentals of Chemistry"]', NULL, '2026-08-20 08:24:23', '2026-08-25 04:39:27', NULL, '0cb78bec-f840-5f54-bdeb-58593a417c0b', NULL, 'Senior Lecturer with 13 years of lecture-room experience teaching Foundations of Biology. Committed to student-centred learning and measurable outcomes.', 'other', 'M.Sc. Foundations of Biology', 'Senior Lecturer', '9 Hummingbird Avenue, Belmopan, Cayo', '[{"area": "Foundations of Biology", "level": 92}, {"area": "Fundamentals of Chemistry", "level": 72}]'),
	('5b58cb5b-fcd0-595c-bf22-35748bed4712', '1bfdef77-f486-5d18-a5ab-ffd47890db1c', 'T-1006', 'Rodwell Bailey', 'rodwell.bailey@belmopancomp.edu.bz', '+501-6604989', 'active', '["Introduction to Sociology", "Belizean History"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Senior Lecturer with 16 years of lecture-room experience teaching Introduction to Sociology. Committed to student-centred learning and measurable outcomes.', 'male', 'M.Sc. Introduction to Sociology', 'Senior Lecturer', '80 Constitution Drive, Belmopan, Cayo', '[{"area": "Introduction to Sociology", "level": 95}, {"area": "Belizean History", "level": 77}]'),
	('09e14c12-af0e-5dc0-accd-3ca1860b547a', 'cdddeff7-3066-595f-8e23-fc583408d6fa', 'T-1007', 'Yolanda Cruz', 'yolanda.cruz@belmopancomp.edu.bz', '+501-6484446', 'active', '["Fundamentals of Chemistry", "Foundations of Biology"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Senior Lecturer with 5 years of lecture-room experience teaching Fundamentals of Chemistry. Committed to student-centred learning and measurable outcomes.', 'female', 'M.Sc. Fundamentals of Chemistry', 'Senior Lecturer', '10 Ring Road, Belmopan, Cayo', '[{"area": "Fundamentals of Chemistry", "level": 91}, {"area": "Foundations of Biology", "level": 85}]'),
	('8178617a-767d-581c-abe5-41b20b58e991', '9167ab7e-9fa6-5f2d-914b-318f6733b3d6', 'T-1008', 'Egbert Grinage', 'egbert.grinage@belmopancomp.edu.bz', '+501-6403477', 'active', '["Health Principles"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Lecturer with 17 years of lecture-room experience teaching Health Principles. Committed to student-centred learning and measurable outcomes.', 'male', 'B.Ed. Health Principles', 'Lecturer', '37 Bliss Parade, Belmopan, Cayo', '[{"area": "Health Principles", "level": 84}]'),
	('b9c5b198-f5ca-5603-be2f-4bf743440c3f', '3f90c656-a26c-529d-a168-f4e93a71fa0e', 'T-1009', 'Nadia Rhaburn', 'nadia.rhaburn@belmopancomp.edu.bz', '+501-6900261', 'active', '["Introduction to Computers"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Head of Department with 6 years of lecture-room experience teaching Introduction to Computers. Committed to student-centred learning and measurable outcomes.', 'female', 'M.Ed. Introduction to Computers', 'Head of Department', '6 Melhado Parade, Belmopan, Cayo', '[{"area": "Introduction to Computers", "level": 84}]'),
	('589975e7-9fc4-5901-bbba-4edbf2de746e', 'c9661cb4-d005-52c5-9f7e-8ad3fcdb1bbc', 'T-1002', 'Carlos Mendez', 'carlos.mendez@belmopancomp.edu.bz', '+501-6711828', 'active', '["College English 1", "Belizean History"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Senior Lecturer with 18 years of lecture-room experience teaching College English 1. Committed to student-centred learning and measurable outcomes.', 'male', 'M.Sc. College English 1', 'Senior Lecturer', '20 Bliss Parade, Belmopan, Cayo', '[{"area": "College English 1", "level": 86}, {"area": "Belizean History", "level": 63}]'),
	('dfae9dc8-32d8-4e6c-af4f-5dc4eb40b8aa', NULL, '096543', 'Arturo Hernandez', 'art.hdz25@gmail.com', '6118374', 'active', '["phys"]', NULL, '2026-08-25 04:47:23', '2026-08-25 04:47:23', '0cb78bec-f840-5f54-bdeb-58593a417c0b', '0cb78bec-f840-5f54-bdeb-58593a417c0b', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e4a09116-20bb-54f5-a06d-81c4336e0c4e', '7f80de88-8724-590b-a2be-5b94dc0b72af', 'T-1011', 'Kayla Waight', 'kayla.waight@belmopancomp.edu.bz', '+501-6793867', 'active', '["College English 1", "Introduction to Computers"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Senior Lecturer with 19 years of lecture-room experience teaching College English 1. Committed to student-centred learning and measurable outcomes.', 'female', 'M.Sc. College English 1', 'Senior Lecturer', '35 Melhado Parade, Belmopan, Cayo', '[{"area": "College English 1", "level": 83}, {"area": "Introduction to Computers", "level": 79}]'),
	('50eebce9-8fc1-579a-a78f-a07973a28463', '83d7ae01-93a2-5684-ad47-21d0ea5dfcbc', 'T-1004', 'Devon Flowers', 'devon.flowers@belmopancomp.edu.bz', '+501-6404483', 'active', '["Pre-Calculus", "Intermediate Algebra"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Lecturer with 6 years of lecture-room experience teaching Pre-Calculus. Committed to student-centred learning and measurable outcomes.', 'male', 'B.Ed. Pre-Calculus', 'Lecturer', '58 Forest Drive, Belmopan, Cayo', '[{"area": "Pre-Calculus", "level": 92}, {"area": "Intermediate Algebra", "level": 62}]'),
	('a5cea265-7f68-507e-a12e-b44fe29db7fb', 'bf5e8b60-8758-594e-be41-d6ce2b325038', 'T-1005', 'Sonia Choc', 'sonia.choc@belmopancomp.edu.bz', '+501-6822073', 'active', '["Intermediate Spanish", "College English 1"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Head of Department with 14 years of lecture-room experience teaching Intermediate Spanish. Committed to student-centred learning and measurable outcomes.', 'female', 'M.Ed. Intermediate Spanish', 'Head of Department', '107 Ring Road, Belmopan, Cayo', '[{"area": "Intermediate Spanish", "level": 88}, {"area": "College English 1", "level": 79}]'),
	('4d6305c3-2507-58f8-91bf-ff291c149861', NULL, 'T-1012', 'Trevor Neal', 'trevor.neal@belmopancomp.edu.bz', '+501-6515698', 'inactive', '["Introduction to Sociology", "Health Principles"]', NULL, '2026-08-20 08:24:23', '2026-08-20 08:24:23', NULL, NULL, NULL, 'Lecturer with 19 years of lecture-room experience teaching Introduction to Sociology. Committed to student-centred learning and measurable outcomes.', 'male', 'B.Ed. Introduction to Sociology', 'Lecturer', '17 Forest Drive, Belmopan, Cayo', '[{"area": "Introduction to Sociology", "level": 88}, {"area": "Health Principles", "level": 82}]');

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;

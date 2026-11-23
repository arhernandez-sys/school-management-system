-- Year-end progression (11 Nov 2026): First -> Second -> Completed.

-- ── 1. Per-year record ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `student_year_records` (
  `id` uuid NOT NULL COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK -> student_profiles',
  `academic_year_id` uuid NOT NULL COMMENT 'FK -> academic_years',
  `year_of_study` enum('First','Second') DEFAULT NULL COMMENT 'The level held DURING this year.',
  `result` enum('Promoted','Repeating','Completed') DEFAULT NULL COMMENT 'How the year ended. NULL = not decided yet (year still running).',
  `decided_at` datetime DEFAULT NULL COMMENT 'When the year archive decided `result`.',
  `missing_terms_excused` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Dean exception: sessions not taken this year do not block progression (entered from another school, missed Summer).',
  `excuse_reason` varchar(255) DEFAULT NULL COMMENT 'Why the Dean excused the missing sessions.',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_year_records` (`student_id`,`academic_year_id`),
  KEY `ix_student_year_records_year` (`academic_year_id`),
  KEY `fk_student_year_records_created_by` (`created_by`),
  KEY `fk_student_year_records_updated_by` (`updated_by`),
  CONSTRAINT `fk_student_year_records_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_student_year_records_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_student_year_records_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_year_records_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ── 2. Per-course Dean exception ────────────────────────────────────────────
ALTER TABLE `class_enrollments`
  ADD COLUMN IF NOT EXISTS `progression_excused` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'Dean exception: this course does not block year-end progression even if failed / withdrawn / ungraded. Does NOT change the grade, GPA or transcript.'
    AFTER `enrollment_status`,
  ADD COLUMN IF NOT EXISTS `progression_excuse_reason` varchar(255) DEFAULT NULL
    COMMENT 'Why the Dean excused this course.'
    AFTER `progression_excused`;

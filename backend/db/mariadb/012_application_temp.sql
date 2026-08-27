-- ============================================================================
-- 012_application_temp.sql
-- D38 - `student_profile_temp`: the holding table for a SAVED-BUT-UNSUBMITTED
--       admission form.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> ... -> 010 -> 011 -> **012**
-- Companion doc : docs/d38-pending-applications-plan.md
-- Verify with   : db/mariadb/apply_sql.py --check
--
-- ── WHY A SECOND TABLE ──────────────────────────────────────────────────────
--
-- Until D38 the admissions wizard PATCHed `applications` on every step, so a form the
-- Registrar was still typing was already an admissions record: it showed up in the
-- directory, it was counted, and the Dean could read it. The client asked for the
-- reverse - nothing enters the admissions record until it is deliberately saved, and an
-- unsubmitted form belongs to whoever is typing it.
--
-- That is a different OWNERSHIP rule from `applications` (a shared record), which is why
-- it is a different table rather than another `status` value. `created_by` is the scope
-- here, not just provenance: a Registrar sees only their own rows, the Dean sees all.
--
-- `applications.status = 'draft'` is left alone. Rows filed before D38 keep working.
--
-- ── WHAT IS AND IS NOT MIRRORED ─────────────────────────────────────────────
--
-- Every column a CLIENT may write is mirrored, under the same spelling, so promotion is
-- an attribute-for-attribute copy. Five columns are deliberately absent:
--
--     date_accepted   student_code   decided_by_user_id   decided_at   student_id
--
-- All five are written by the ACCEPT transition. A pending form has no decision and no
-- student, so mirroring `student_id` would mean an FK to `student_profiles` that could
-- never be satisfied.
--
-- Sections B and F are `longtext`/JSON arrays rather than duplicated child tables. On
-- `applications` they are `application_education` and `application_documents`, keyed by
-- an application id a pending form has not got; three tables to express one saved form
-- buys nothing when no one may query a pending row by institution or document type.
-- `service.submit_pending_application` expands them into the real child tables.
--
-- Hard-deleted (no `deleted_at`): the row either became an application or was abandoned.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `student_profile_temp` (
  `id`                    uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  -- Always 'pending'. NOT the `applications.status` enum: adding a member there would
  -- widen the vocabulary the decision queue is built on.
  `status`                varchar(20) NOT NULL DEFAULT 'pending',
  `school_year`           varchar(20) NULL COMMENT 'Form header: School year',

  -- Section A - personal
  `firstname`             varchar(50) NOT NULL,
  `middlename`            varchar(50) NULL,
  `lastname`              varchar(50) NOT NULL,
  `date_of_birth`         date NULL,
  `ssno`                  varchar(9) NULL COMMENT 'Social Security No.',
  `gender`                varchar(25) NULL,
  `civil_status`          varchar(50) NULL,
  `religion`              varchar(100) NULL,
  `phone`                 varchar(50) NULL,
  `email`                 varchar(254) NULL,
  `has_health_condition`  tinyint(1) NOT NULL DEFAULT 0,
  `health_condition_note` text NULL,

  -- Section A - address
  `street`                varchar(200) NULL,
  `city_town_village`     varchar(200) NULL,
  `district`              enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') NULL,

  -- Section A - parents and next of kin
  `mother_name`           varchar(200) NULL,
  `father_name`           varchar(200) NULL,
  `nok_name`              varchar(200) NULL,
  `nok_relationship`      varchar(100) NULL,
  `nok_phone`             varchar(50) NULL,

  -- Section B - examinations, then the institution table as a JSON array
  `atlib_exam`            tinyint(1) NOT NULL DEFAULT 0,
  `num_csec`              smallint(6) NULL COMMENT 'Number of CSEC Exams (1-8+)',
  -- COMMENT must precede CHECK in a MariaDB column definition; the json_valid()
  -- constraints are table-level below for that reason.
  `education_json`        longtext NULL
      COMMENT 'Section B institutions; expanded into application_education on submit',

  -- Section C - financial
  `finance_name`          varchar(200) NULL,
  `finance_phone`         varchar(50) NULL,
  `finance_email`         varchar(254) NULL,

  -- Section D - recommendation
  `recommendation_received` tinyint(1) NOT NULL DEFAULT 0,

  -- Section E - programme of study
  `program_id`            uuid NULL COMMENT 'FK -> programs',
  `year_of_study`         enum('First','Second') NULL,
  `enrollment_load`       enum('Part Time','Full Time','Transient') NULL,

  -- Section F - the document checklist, as a JSON array
  `documents_json`        longtext NULL
      COMMENT 'Section F checklist; expanded into application_documents on submit',

  -- Section G - agreement
  `applicant_signed_at`   date NULL,
  `guardian_signed_at`    date NULL COMMENT 'Required only if the applicant is under 18',

  -- FOR OFFICIAL USE ONLY - the client-writable half only
  `academic_year_id`      uuid NULL COMMENT 'FK -> academic_years',
  `enrolment_status`      varchar(50) NULL,
  `comments`              text NULL COMMENT 'Comments/Observations',

  `created_at`            datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`            datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  -- THE SCOPE, not just audit: a Registrar sees only their own pending forms.
  `created_by`            uuid NULL,
  `updated_by`            uuid NULL,
  PRIMARY KEY (`id`),
  -- "my pending forms, surname first" for a Registrar; the Dean drops the leading
  -- predicate and still gets the name ordering.
  KEY `ix_apptemp_created_by` (`created_by`,`lastname`,`firstname`),
  KEY `fk_apptemp_program` (`program_id`),
  KEY `fk_apptemp_year` (`academic_year_id`),
  KEY `fk_apptemp_updated_by` (`updated_by`),
  CONSTRAINT `fk_apptemp_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_year` FOREIGN KEY (`academic_year_id`)
    REFERENCES `academic_years` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apptemp_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_apptemp_num_csec` CHECK (`num_csec` IS NULL OR `num_csec` BETWEEN 0 AND 20),
  CONSTRAINT `ck_apptemp_education_json` CHECK (`education_json` IS NULL OR json_valid(`education_json`)),
  CONSTRAINT `ck_apptemp_documents_json` CHECK (`documents_json` IS NULL OR json_valid(`documents_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

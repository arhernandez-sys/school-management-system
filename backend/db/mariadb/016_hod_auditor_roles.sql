-- ============================================================================
-- 016_hod_auditor_roles.sql
-- D43 - two new roles (`auditor`, `hod`) and the programme link an HOD is scoped by.
--
-- Target engine : MariaDB 12.3.2
-- Run order     : sims.sql -> 001 -> ... -> 014 -> 015 -> **016**
-- Companion doc : docs/d43-hod-auditor-roles-and-course-print.md
-- Verify with   : db/mariadb/verify_schema.py --expect 016
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--
--   1. `users.role` grows from four labels to six.
--   2. `program_heads` - a NEW table linking a lecturer to the programme(s) they head.
--
-- ── 1. THE ROLE ENUM ────────────────────────────────────────────────────────
--
-- Nothing in 001-015 has ever touched this column; it has read
-- enum('principal','secretary','teacher','student') since `sims.sql`. Alembic cannot
-- do this - its single revision is Postgres-only and non-functional here (see
-- docs/tertiary-refactor-plan.md SC), so the ALTER is hand-run like every other
-- change in this chain.
--
--   auditor  Reads everything, writes nothing. The refusal is NOT expressed here and
--            could not be: a column cannot know an HTTP method. It lives in
--            `app/core/deps.py::get_current_user`, the one dependency every
--            authenticated route passes through, so no route can opt out of it by
--            being forgotten. This column only has to be able to HOLD the value.
--
--   hod      Head of Department - a lecturer who also supervises a programme. Their
--            teaching rights are unchanged and are enforced by OWNERSHIP
--            (`class_teachers`), not by this label; what the label adds is the
--            programme-wide read scope, via `program_heads` below.
--
-- WIDENING AN ENUM IS SAFE. MariaDB stores the ordinal, and both new labels are
-- APPENDED, so every existing row keeps its value and no index is invalidated. This
-- would not be true if the labels were inserted in the middle - do not reorder them.
--
-- The column is left NOT NULL with no default, exactly as it was: a user without a
-- role is not a state this system has.
-- ----------------------------------------------------------------------------

ALTER TABLE `users`
  MODIFY COLUMN `role`
    enum('principal','secretary','teacher','student','hod','auditor')
    NOT NULL
    COMMENT 'principal / secretary / teacher / student / hod / auditor';


-- ----------------------------------------------------------------------------
-- 2. `program_heads` - WHO HEADS WHICH PROGRAMME
--
-- WHY A JOIN TABLE AND NOT A COLUMN. `teacher_profiles.headed_program_id` would have
-- been smaller, and wrong in both directions at a college this size: a lecturer can
-- head two programmes, and a programme can have co-heads during a handover. Neither is
-- exotic, and both are unrepresentable in a single FK. This mirrors `class_teachers`,
-- which solved the same shape for (offering, lecturer).
--
-- WHY IT HANGS OFF `teacher_profiles` AND NOT `users`. An HOD is a lecturer first. All
-- the scoping this table feeds - their offerings, their programme's lecturers - is
-- already expressed in terms of a teacher profile id, and `class_teachers.teacher_id`
-- points at the same place. Hanging it off `users` would mean joining back through
-- `teacher_profiles` on every query to say the same thing.
--
-- NOTE THE ROLE IS NOT ENFORCED HERE. A row may exist for a lecturer whose `users.role`
-- is still `teacher`; it simply grants nothing until the role is changed. That is
-- deliberate - appointing the head and provisioning the login are two acts, often days
-- apart, and a CHECK spanning two tables is not something MariaDB will enforce anyway.
-- The authorization reads the ROLE first and this table second.
--
-- ON DELETE CASCADE on both parents: an appointment is meaningless once either the
-- programme or the lecturer is gone. Note `programs` and `teacher_profiles` are both
-- SOFT-deleted in practice, so a live cascade is the rare hard-delete path only.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `program_heads` (
  `id`           uuid     NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `program_id`   uuid     NOT NULL COMMENT 'FK -> programs. The unit being headed.',
  `teacher_id`   uuid     NOT NULL COMMENT 'FK -> teacher_profiles. The lecturer heading it.',
  `appointed_at` datetime NOT NULL DEFAULT current_timestamp()
      COMMENT 'When the appointment took effect. Display/audit only - scope is not time-sliced.',
  `created_at`   datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`   datetime     NULL DEFAULT NULL ON UPDATE current_timestamp()
      COMMENT 'NULL until edited - the 015 convention.',
  `created_by`   uuid         NULL,
  `updated_by`   uuid         NULL,
  PRIMARY KEY (`id`),
  -- One appointment per (programme, lecturer). Re-appointing is an upsert, not a
  -- second row, so the scope query can never double-count a programme.
  UNIQUE KEY `uq_program_heads` (`program_id`,`teacher_id`),
  -- The hot path is "which programmes does THIS lecturer head", resolved from the
  -- principal on every scoped request; the unique key above cannot serve it because
  -- `teacher_id` is its second column.
  KEY `ix_program_heads_teacher` (`teacher_id`),
  KEY `fk_program_heads_created_by` (`created_by`),
  KEY `fk_program_heads_updated_by` (`updated_by`),
  CONSTRAINT `fk_program_heads_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_heads_teacher` FOREIGN KEY (`teacher_id`)
    REFERENCES `teacher_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_heads_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_program_heads_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT = 'Head of Department appointments: lecturer <-> programme, many-to-many (D43).';

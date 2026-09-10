-- ============================================================================
-- 020_d45_audit_trail.sql
--
-- D45 Phase 7 — Audit Trail enrichment (§46), and the §53 Audit Reports it feeds.
--
-- §46 asks the log to answer, for a sensitive action: WHO did it, WHEN, in WHICH
-- module, and WHAT THE VALUE WAS BEFORE AND AFTER. Today `audit_log` has
-- `actor_user_id, action, entity_type, entity_id, summary, created_at`. Who and
-- when are already there. Module, IP and the before/after pair are not, and the
-- before/after is the one §46 gives a worked example of:
--
--     "a final grade going C+ -> B, citing a change request"
--
-- ...which is not reproducible from the log as it stands. `grade.update` writes
-- `{"entries": 3}` — the COUNT of cells touched, with no student, no score and no
-- previous value. The columns below are half the fix; the other half is the write
-- side, which now emits one row per grade actually changed.
--
-- ⚠️ RUN THIS AFTER THE PHASE 7 CODE IS MERGED. All four columns are nullable and
--    additive, so a database ahead of the code is harmless — but the code writes
--    them, so a database BEHIND the code is a 500 on every audited action, which
--    is every write in the system.
--
-- ⚠️ RETENTION. The document's own closing note applies here and is worth reading
--    before this runs: "Audit and Historical data will drastically increase
--    database space." `previous_value` / `new_value` on every sensitive write is
--    the single largest growth driver in the whole D45 plan. Sizing, measured on
--    the 46-student `sims`:
--
--      * a grade-change row is ~400 bytes with both values populated
--      * one full assessment gradebook for a 30-seat offering = ~30 rows if every
--        mark is edited, and marks are typically edited more than once
--      * ~150 offerings x ~6 assessments x ~30 students, entered and revised, is
--        on the order of 10^5 rows/year -> tens of MB/year. NOT a problem at BAJC's
--        size, and it would be at 10x the enrolment.
--
--    No purge job is created here deliberately: an audit trail that deletes itself
--    on a schedule nobody agreed is worse than one that grows. See §7 item 12 of
--    docs/d45-meeting4-yellow-plan.md — BAJC must set a retention period, and it is
--    a policy decision, not a technical one.
-- ============================================================================

-- --------------------------------------------------------------------------
-- §46 — the four fields the blueprint names.
-- --------------------------------------------------------------------------
ALTER TABLE `audit_log`
  ADD COLUMN IF NOT EXISTS `module` varchar(40) NULL
    COMMENT 'D45 §46 - the FUNCTIONAL area (Grades, Enrolment, Admissions...). Distinct from entity_type, which names a TABLE: an auditor asks "what happened in Grades", not "what happened to the assessment_grades row".',
  ADD COLUMN IF NOT EXISTS `ip_address` varchar(45) NULL
    COMMENT 'D45 §46, "where appropriate". 45 chars = the maximum length of an IPv6 literal. NULL for anything not raised by an HTTP request (seeds, migrations, scheduled work).',
  ADD COLUMN IF NOT EXISTS `previous_value` longtext NULL
    COMMENT 'D45 §46 - JSON object, the value(s) BEFORE the change. NULL on a creation.',
  ADD COLUMN IF NOT EXISTS `new_value` longtext NULL
    COMMENT 'D45 §46 - JSON object, the value(s) AFTER the change. NULL on a deletion.';

-- --------------------------------------------------------------------------
-- §53 Audit Reports read this table by module and by date, and the auditor's
-- screen is date-descending. Without these it is a full scan of an append-only
-- table that only ever grows.
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS `ix_audit_created_at` ON `audit_log` (`created_at` DESC);
CREATE INDEX IF NOT EXISTS `ix_audit_module_created` ON `audit_log` (`module`, `created_at` DESC);
CREATE INDEX IF NOT EXISTS `ix_audit_action_created` ON `audit_log` (`action`, `created_at` DESC);
CREATE INDEX IF NOT EXISTS `ix_audit_actor_created` ON `audit_log` (`actor_user_id`, `created_at` DESC);

-- --------------------------------------------------------------------------
-- Backfill `module` for the rows already on disk.
--
-- Derived from the `action` prefix, which is how the application derives it too —
-- one rule, in two places, deliberately: an existing row has no other evidence of
-- which module it came from, and leaving thousands of rows with a NULL module
-- would put them outside every §53 report that filters on it.
--
-- `previous_value` / `new_value` are NOT backfilled and cannot be: the information
-- was never captured. Those rows keep whatever prose is in `summary`, and the
-- auditor's screen says plainly that a before/after is unavailable for actions
-- recorded before this migration, rather than implying nothing changed.
-- --------------------------------------------------------------------------
UPDATE `audit_log` SET `module` =
  CASE
    WHEN `action` LIKE 'grade.%'              THEN 'Grades'
    WHEN `action` LIKE 'grade_revision.%'     THEN 'Grades'
    WHEN `action` LIKE 'report_card.%'        THEN 'Grades'
    WHEN `action` LIKE 'assessment.%'         THEN 'Assessments'
    WHEN `action` LIKE 'category.%'           THEN 'Assessments'
    WHEN `action` LIKE 'assessment_policy.%'  THEN 'Assessments'
    WHEN `action` LIKE 'attendance.%'         THEN 'Attendance'
    WHEN `action` LIKE 'application.%'        THEN 'Admissions'
    WHEN `action` LIKE 'credit_transfer.%'    THEN 'Admissions'
    WHEN `action` LIKE 'student.%'            THEN 'Students'
    WHEN `action` LIKE 'enrollment.%'         THEN 'Registration'
    WHEN `action` IN ('offering.enroll','offering.unenroll','offering.enrollment_status')
                                              THEN 'Registration'
    WHEN `action` LIKE 'offering.%'           THEN 'Course offerings'
    WHEN `action` LIKE 'course_prerequisite.%' THEN 'Courses'
    WHEN `action` LIKE 'course.%'             THEN 'Courses'
    WHEN `action` LIKE 'program.%'            THEN 'Programmes'
    WHEN `action` LIKE 'teacher.%'            THEN 'Staff'
    WHEN `action` LIKE 'user.%'               THEN 'Users and access'
    WHEN `action` LIKE 'academic_year.%'      THEN 'Academic calendar'
    WHEN `action` LIKE 'semester.%'           THEN 'Academic calendar'
    WHEN `action` LIKE 'event.%'              THEN 'Academic calendar'
    WHEN `action` LIKE 'grading_scale.%'      THEN 'Academic calendar'
    WHEN `action` LIKE 'announcement.%'       THEN 'Announcements'
    WHEN `action` LIKE 'school.%'             THEN 'System settings'
    ELSE 'System settings'
  END
WHERE `module` IS NULL;

-- --------------------------------------------------------------------------
-- Verify. Expect: zero NULL modules, and four new columns present.
-- --------------------------------------------------------------------------
-- SELECT `module`, COUNT(*) FROM `audit_log` GROUP BY `module` ORDER BY 2 DESC;
-- SELECT COUNT(*) AS should_be_zero FROM `audit_log` WHERE `module` IS NULL;
-- SHOW COLUMNS FROM `audit_log`;


ALTER TABLE `attendance_records`
  ADD COLUMN IF NOT EXISTS `session_start` time DEFAULT NULL
    COMMENT 'Start time of the scheduled class_meetings slot this mark belongs to. NULL = recorded before per-session attendance (Nov 2026).'
    AFTER `attendance_date`;

CREATE UNIQUE INDEX IF NOT EXISTS `uq_attendance_offering_student_session`
  ON `attendance_records` (`offering_id`, `student_id`, `attendance_date`, `session_start`);

DROP INDEX IF EXISTS `uq_attendance_offering_student_date` ON `attendance_records`;
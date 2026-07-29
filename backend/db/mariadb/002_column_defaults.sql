-- ============================================================================
-- 002_column_defaults.sql
-- Add the CURRENT_TIMESTAMP defaults the ORM relies on (server_default=now())
-- but which the base sims schema / 001 reconciliation did not set on three
-- non-mixin timestamp columns. Without these, the ORM omits the column on
-- INSERT (expecting the DB to fill it) and MariaDB raises
-- ERROR 1364 "Field '...' doesn't have a default value" — which blocks the
-- entire auth flow (every login writes login_attempts, and issuing a refresh
-- session writes issued_at/last_used_at).
--
-- Safe + idempotent: re-applying MODIFY with the same definition is a no-op.
-- ============================================================================
USE `sims`;

ALTER TABLE `login_attempts`
  MODIFY COLUMN `attempted_at` datetime NOT NULL DEFAULT current_timestamp();

ALTER TABLE `refresh_sessions`
  MODIFY COLUMN `issued_at`    datetime NOT NULL DEFAULT current_timestamp(),
  MODIFY COLUMN `last_used_at` datetime NOT NULL DEFAULT current_timestamp();

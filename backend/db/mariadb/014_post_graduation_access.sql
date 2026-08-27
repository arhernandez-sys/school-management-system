-- ============================================================================
-- 014_post_graduation_access.sql
-- D39 - how long a graduate keeps online access (Meeting #2 item 6).
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> ... -> 012 -> 013 -> **014**
-- Companion doc : docs/d39-meeting2-feedback-plan.md
-- Verify with   : db/mariadb/verify_schema.py --expect 014
--
-- ── WHAT AND WHY ────────────────────────────────────────────────────────────
--
-- Meeting #2 item 6: "Set Availability of Grades/online access to students after
-- graduation, for a period, recommended time is 3 months."
--
-- 90 days is the recommendation, and it is a DEFAULT rather than a constant because it
-- is a policy the Dean should be able to change without a deployment. It lives on
-- `school_profile` - the singleton this schema already uses for operator-set policy -
-- rather than in a config file, so that a change is audited and survives a redeploy.
--
-- ── THE COLUMN IS NULLABLE, AND NULL MEANS "NO EXPIRY" ──────────────────────
--
-- Not "expire immediately". A school that has not thought about this question yet must
-- not silently lock its alumni out on the day this migration runs; and the schools most
-- likely to leave it unset are the ones with no policy, for whom the safe reading is
-- "carry on as before". `0` is the spelling for "access ends the day they graduate" -
-- distinguishable from NULL, and something an operator has to type on purpose.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Non-destructive - adds one nullable column with
-- a default and writes no rows.
-- ============================================================================

USE `sims`;

ALTER TABLE `school_profile`
  ADD COLUMN IF NOT EXISTS `post_graduation_access_days` smallint(6) NULL DEFAULT 90
    COMMENT 'D39 (Meeting #2 item 6). Days a graduated student keeps grade/online access, counted from graduation_date. NULL = never expires; 0 = access ends on graduation day. Default 90 = the client''s recommended 3 months.';

-- Backfill the existing singleton row. `ADD COLUMN ... DEFAULT 90` already applies the
-- default to existing rows in MariaDB, but stating it makes the intent survive a reader
-- who is checking rather than assuming, and makes the file safe to run against a
-- database where someone added the column by hand without a default.
UPDATE `school_profile`
SET `post_graduation_access_days` = 90
WHERE `post_graduation_access_days` IS NULL
  AND `id` = 1;

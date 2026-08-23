# MariaDB reconciliation — `sims` DB vs SIS backend ORM + finished frontend

`001_missing_fields.sql` brings the self-hosted **MariaDB 12.3.2** `sims` database
(HeidiSQL, `utf8mb4` / `utf8mb4_uca1400_ai_ci`, case-insensitive) up to what the
FastAPI/SQLAlchemy ORM models and the finished React frontend expect.

- **Authoritative sources:** the ORM mapped column names (`backend/app/db/base.py`
  mixins + every `backend/app/modules/*/models.py`) are the fixed reference; the DB is
  made to match. Design intent came from `docs/database-schema.md` (Postgres) and was
  translated to MariaDB. Frontend fields came from
  `frontend/src/shared/api/mocks/demo/types.ts` and `handlers/events.ts`.
- **How to run:** open in HeidiSQL against the `sims` database and execute the whole
  file. It disables FK checks and relaxes `sql_mode` for the duration, then restores
  both. Re-runnable: additive steps use `IF [NOT] EXISTS`; renames / type changes /
  PK swaps / the table rename are guarded by `information_schema` prepared statements.
- **Postgres → MariaDB translation:** `timestamptz`→`datetime`, `boolean`→`tinyint(1)`,
  `jsonb`→`longtext`+`CHECK (json_valid(...))`, **partial UNIQUE index**→a `STORED`
  generated column that is `NULL` for soft-deleted/inactive rows (NULLs are distinct in
  a MariaDB UNIQUE), reusing the pattern already in `sims.sql`
  (`active_flag` / `is_active_number` / `unique_code` / `active_username`).

## Running a file

`apply_sql.py` applies one of these files from a terminal, reading `DATABASE_URL` from
`backend/.env` so there is no second copy of the credentials. Run it from `backend\`.

```powershell
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py --check                      # tables + row counts
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py --backup pre.sql             # SHOW CREATE TABLE snapshot
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\005_tertiary.sql  # apply
```

It runs statements one at a time and prints each result, so a failure names the exact
statement rather than aborting the file with no context. HeidiSQL still works if you
prefer it. This exists because Alembic is non-functional against MariaDB here.

## Run order

Apply in numeric order; each is re-runnable.

**`010` was EXECUTED on 2026-08-23 (D34)** — all seven D31 quarantine tables are dropped
and the database is down to 39 tables, the ORM's own count. Its statements remain commented
out as a record; re-running it would fail on tables that no longer exist, by design.

**`011_client_schema_reconcile.sql` reconciles `student_profiles` with the CLIENT'S own
schema** (D34): ten new columns, `'Summer'` on `enrollment_load`, and the student-status
vocabulary moved to `Registered` / `Unregistered` / `DropOut`. Unlike `009` it **cannot be
applied ahead of the application code** — §3 rewrites the `status` column, and a backend
still on `"active"` would silently match zero rows on every active-student filter rather
than failing. Applied to live `sims` 2026-08-23, 26/26 statements, after dumping the 46
`student_profiles` rows (`--backup` is schema-only). Read
`docs/d34-client-schema-reconcile-plan.md` §A first: most of what looked like a missing
column was a rename this chain had already done. `seed_demo.py` loads demo data and is not
part of the schema chain.

**`010_seed_demo.sql` is no longer in this directory, and that is deliberate (D31 Phase
5).** `seed_demo.py` now writes it to the untracked `generated/` folder alongside
`generated/demo-credentials.txt`, because the file carries per-account Argon2 hashes of
passwords generated on that run. The tracked version shared ONE hardcoded password
(`SimsDemo2025!`) across all 19 accounts with `must_change_password=false`, so rotating
the constant in the script never fixed the checked-in SQL — the hash was in git either
way. Re-generate it; never copy one between machines.

```powershell
# from backend\, with the catalog already seeded (python -m app.db.seed_bajc)
$env:ENVIRONMENT="local"; $env:SIS_ALLOW_DEMO_SEED="yes-destroy-my-data"
.\.venv\Scripts\python.exe -m db.mariadb.seed_demo
# logins: db\mariadb\generated\demo-credentials.txt
```

Every seeded account starts with `must_change_password=true`, which the server now
ENFORCES — the API answers 403 `password_change_required` on everything except
`GET /auth/me`, `PATCH /auth/me/password` and `POST /auth/logout` until the password is
changed (`app/core/deps.py`).

| File | What it does |
|---|---|
| `001_missing_fields.sql` | The bulk reconciliation documented below. |
| `002_column_defaults.sql` | `CURRENT_TIMESTAMP` defaults on three non-mixin timestamp columns (without them, every login fails with ERROR 1364). |
| `003_subjects_is_active.sql` | Makes `subjects.is_active` a real column — 001 modelled it as generated, which MariaDB refuses to let the service write (ERROR 1906). |
| `004_subject_class_model.sql` | **D29 sixth-form subject-class model:** new `class_meetings` table + `student_profiles.year_group`. See that file's header for why the reframe needed so little DDL. |
| `005_tertiary.sql` | **D30 tertiary / junior-college model (BAJC).** Merges the stakeholder's `sims_bk.sql` tertiary work on top of 001–004. Adds the `courses` catalog (closing the grade→credit chain that made GPA impossible), `programs`, `program_courses`, `course_prerequisites`, grade points / quality points, N calendar terms + the grade-submission deadline, the application & credit-transfer tables, programme history, grade-revision requests, and `YYYYMM###` student-ID sequences. Legacy tertiary tables are **quarantined by rename** to `*_legacy_pre_d30`, never dropped. Full rationale in that file's header and in `docs/tertiary-refactor-plan.md`. |
| `006_courses_cutover.sql` | **D30 Phase 2A — swaps the catalog from `subjects` to `courses`.** Applied 2026-08-16, in the same step as the code change that points `Subject.__tablename__` at `courses`. ⚠️ It must never be applied against an older checkout of the app: `005` copied the EXISTING rows into `courses`, but until the ORM writes there too, a newly-created course has nothing for the FK to resolve against and every attach fails with 1452 (this cost 73 test failures once). `subjects` is kept and commented as retired, not dropped. |
| `007_student_names.sql` | **D30 Phase 1 — retires `student_profiles.full_name`.** Tightens `lastname` to NOT NULL (`firstname` stays nullable for the legacy single-token names `005` §9 parked there) and drops `full_name`, which becomes a `hybrid_property` on `StudentProfile`. Same apply-with-the-code rule as `006`. |
| `008_course_offerings.sql` | **D31 — collapses the K-12 offering layer into a tertiary one.** New `course_offerings` table (one course, one semester, one optional section) absorbing `classes` + `class_subjects`; every child re-pointed from `class_subject_id`/`class_id` to `offering_id`. ⚠️ **DESTRUCTIVE and must land in the SAME STEP as the code that expects it**, exactly like `006` — the homeroom-era operational data is DELETED rather than migrated (a year-scoped homeroom cannot say which semester it taught in, and its enrolments pointed at a homeroom rather than a course). The deletes are gated on a PRE-COLLAPSE SENTINEL so a replay after re-seeding destroys nothing. Read that file's header before running it, and re-seed with `seed_demo.py` afterwards. Verify with `verify_schema.py --expect 008`. **APPLIED TO `sims` 2026-08-20 (20/20 probes) and re-seeded** — the cut-over is done and `sims` is the working target again. |

| `009_midterm_windows.sql` | **D32 — mid-term grading windows, student grade visibility, two report kinds.** Adds `semesters.midterm_submission_start`/`_end` (+ `ck_semesters_midterm_window`), `assessment_policies.students_can_view_grades` (default 0), and `report_card_snapshots.kind` with the unique key widened to `(student_id, semester_id, kind)`. **Safe and additive** — it deletes nothing, migrates no rows, and every default reproduces today's behaviour, so unlike `006`/`008` it can be applied before the code that uses it. **APPLIED TO `sims` 2026-08-21 (15/15 statements)** after `--backup pre_009_backup.sql`. Rationale in `docs/midterm-revision-reports-plan.md` §B. |
| `010_drop_legacy_pre_d31.sql` | **D32 §7 — the legacy-table audit, as an executable file.** ⚠️ **Every DROP in it is commented out and it is NOT part of the run chain.** Applying it as-is runs two read-only pre-flight SELECTs and nothing else (verified 2026-08-21). §2 drops the five tables the audit cleared; §3 holds the two that still carry rows and needs BAJC's sign-off. See the audit summary below and the full table in `docs/midterm-revision-reports-plan.md` §A5. |

## Legacy tables — audit summary (D32, 2026-08-21)

The live `sims` holds **46 tables**; the ORM maps **39**. The seven others are all D31
quarantine renames (`008` renames rather than drops, by design). Nothing in the ORM, the
API, the services or the frontend references any of them, and the only raw SQL in
`backend/app` is `SELECT 1` in `db/session.py` — so an ORM sweep is a complete reference
sweep. The database also has **0 views, 0 stored routines and 0 triggers**.

| Table | Rows | Verdict |
|---|---|---|
| `grades_legacy_pre_d31` | 0 | ✅ Safe to remove |
| `staff_legacy_pre_d31` | 0 | ✅ Safe to remove |
| `students_legacy_pre_d31` | 0 | ✅ Safe to remove |
| `cat_assessment_legacy_pre_d31` | 0 | ✅ Safe to remove |
| `subjects_legacy_pre_d31` | 11 | ✅ Safe to remove — all 11 rows verified present in `courses` under the same id and code |
| `classes_legacy_pre_d31` | 17 | ⚠️ Requires a decision — the only surviving record of the homeroom era |
| `class_subjects_legacy_pre_d31` | 116 | ⚠️ Requires a decision — same |

**No live table holds a foreign key into any of them.** The reverse is not true, and it is
the argument for eventually dropping the two populated ones: they hold outbound FKs onto
live `users`, `academic_years` and `courses`, so a retired 2024-era row can still block a
delete on a live one.

## Mixin column reference (from `db/base.py`)

| Mixin | Columns added (MariaDB) |
|---|---|
| `TimestampMixin` | `created_at datetime NOT NULL DEFAULT current_timestamp()`, `updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()` |
| `AuditMixin` | `created_by uuid NULL`, `updated_by uuid NULL` — both FK → `users(id)` `ON DELETE SET NULL` |
| `SoftDeleteMixin` | `deleted_at datetime NULL` |

## Change manifest

| Table | Change | Reason (ORM model / frontend need) |
|---|---|---|
| `users` | `locked_until`, `last_login_at`: `DEFAULT '0000-00-00 00:00:00'` → `NULL` (+ UPDATE existing bad values) | `User.locked_until` / `last_login_at` are nullable, no default; zero-date is invalid |
| `users` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `User(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `users` | Drop plain `email` + `uq_users_email`; add `active_email` generated col + partial `uq_users_email(active_email)` | ORM `uq_users_email` is unique **only where `deleted_at IS NULL`** |
| `users` | Drop too-strict plain `username` unique (keep partial `uq_users_username` on `active_username`) | ORM `uq_users_username` is partial (deleted_at IS NULL AND username IS NOT NULL) |
| `user_preferences` | + `created_at`, `updated_at` | `UserPreferences(TimestampMixin)` |
| `refresh_sessions` | `token_hash` `varbinary(50)` → `varchar(64)`; drop duplicate plain unique | `security.sha256_hash()` returns a 64-char **hex** string; 50 bytes truncates it |
| `refresh_sessions` | + `created_at`, `updated_at` | `RefreshSession(TimestampMixin)` |
| `password_reset_tokens` | + `created_at`, `updated_at` | `PasswordResetToken(TimestampMixin)` |
| `student_profiles` | `user_id` `NOT NULL` → `NULL`; + FK `fk_student_profiles_user` (SET NULL) | `StudentProfile.user_id` is nullable with `ondelete=SET NULL` |
| `student_profiles` | `enrollment_date` → `NOT NULL` | `StudentProfile.enrollment_date` is `nullable=False` (see caveat below) |
| `student_profiles` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `StudentProfile(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `student_documents` | + `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by` | `StudentDocument(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `student_documents` | + FK `fk_student_documents_student` (RESTRICT) + audit FKs | ORM FK `student_id → student_profiles ondelete=RESTRICT` |
| `student_documents` | + `UNIQUE(storage_key)` (`uq_student_documents_key`) | ORM unique index on `storage_key` |
| `teacher_profiles` | `deleted_at` `int(1)` → `datetime NULL` (rebuilds `is_active` generated col + `uq_teacher_profiles_number`) | Wrong type; soft-delete needs a timestamp |
| `teacher_profiles` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `TeacherProfile(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `teacher_profiles` | + `UNIQUE(user_id)` (`uq_teacher_profiles_user`) | ORM partial unique on `user_id` (NULLs distinct in MariaDB) |
| `teacher_profiles` | + `avatar_url`, `bio`, `gender`, `education`, `designation`, `address`, `expertise`(JSON) | **Frontend only** `DemoTeacher` extended profile; not yet in the ORM |
| `subjects` | Rename `subjectName` → `name` | ORM `Subject.name` |
| `subjects` | `code` `NOT NULL` → `NULL`; `category` `NOT NULL` → `NULL` | ORM `code` nullable; `category` is legacy/unmanaged (would block ORM inserts) |
| `subjects` | + `created_at`, `updated_at` | `Subject(TimestampMixin, SoftDeleteMixin)` |
| `classes` | Rename `className` → `name`; `grade_level` `smallint` → `varchar(50)` | ORM `Class.name` (Text); ORM/`DemoSection.grade_level` is a **string** ("Form 1") |
| `classes` | `classStaffID` `NOT NULL` → `NULL`; `deleted_at` `timestamp` → `datetime` | Legacy col with no default would block ORM inserts; type parity |
| `classes` | + `homeroom_label` | **Frontend only** `DemoSection.homeroom_label`; not in the ORM |
| `classes` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `Class(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `classes` | Drop wrong `uq_classes_year_name(academic_year_id)`; add `active_class_name` generated col + `uq_classes_year_name(academic_year_id, active_class_name)` | ORM unique is `(academic_year_id, name) WHERE deleted_at IS NULL` — sims had it on the **year alone** (one class per year!) |
| `class_subjects` | + `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `ClassSubject(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `class_subjects` | Replace `uq_class_subjects_class_subject` with partial via `cs_active_subject` generated col | ORM unique is `(class_id, subject_id) WHERE deleted_at IS NULL` |
| `class_teachers` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `ClassTeacher(TimestampMixin, AuditMixin)` |
| `class_enrollments` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `ClassEnrollment(TimestampMixin, AuditMixin)` |
| `class_enrollments` | Replace `uq_enroll_active` with partial via `enroll_active_flag` generated col | ORM unique is `(class_id, student_id, semester_id) WHERE unenrolled_at IS NULL` |
| `academic_years` | `yearID`, `YEAR` `NOT NULL` → `NULL` | Legacy cols with no default would block ORM inserts |
| `academic_years` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `AcademicYear(TimestampMixin, AuditMixin)` |
| `semesters` | + `created_at`, `updated_at` | `Semester(TimestampMixin)` |
| `grading_scales` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `GradingScale(TimestampMixin, AuditMixin)` |
| `grading_scale_bands` | + `created_at`, `updated_at` | `GradingScaleBand(TimestampMixin)` |
| `assessment_policies` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `AssessmentPolicy(TimestampMixin, AuditMixin)` |
| `school_profile` | + **PRIMARY KEY (id)** + `CHECK(id = 1)` | sims had no PK / no singleton guard; ORM `id` is PK pinned to 1 |
| `school_profile` | + `color_primary`, `color_secondary` | **Frontend only** `DemoSchoolProfile.colors.{primary,secondary}`; not in the ORM |
| `school_profile` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `SchoolProfile(TimestampMixin, AuditMixin)` |
| `audit_log` | `id` bigint → `AUTO_INCREMENT` | ORM `AuditLog.id = BigInteger, Identity(always=True)` |
| `assesment_categories` | **RENAME TABLE → `assessment_categories`** | ORM `__tablename__ = "assessment_categories"` (sims misspelled it with one `s`) |
| `assessment_categories` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `AssessmentCategory(TimestampMixin, AuditMixin)` |
| `assessments` | `type` `enum('Exam','Quiz','Assignment')` → `enum('quiz','test','exam','assignment')` | `AssessmentType` (lowercase wire labels; adds `test`) + `DemoAssessment.type` |
| `assessments` | `status` `enum('draft','published','archived')` → `enum('draft','published','grading','graded')` | `AssessmentStatus` (drops `archived`, adds `grading`/`graded`) |
| `assessments` | + `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) + `ix_assessments_class_subject_semester` | `Assessment(TimestampMixin, AuditMixin, SoftDeleteMixin)` + lookup index |
| `assessment_grades` | `max_score` `NOT NULL` → `NULL` | Legacy/extra col not in the ORM; NOT NULL + no default would block ORM inserts |
| `assessment_grades` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `AssessmentGrade(TimestampMixin, AuditMixin)` |
| `attendance_records` | + FKs `class_id`, `student_id`, `enrollment_id`, `semester_id` (all RESTRICT) | ORM FKs `fk_attendance_*` — sims had **none** |
| `attendance_records` | + `UNIQUE(class_id, student_id, attendance_date)` + `ix_attendance_class_date` + `ix_attendance_student_semester` | ORM upsert key + lookup indexes |
| `attendance_records` | + `created_at`, `updated_at`, `created_by`, `updated_by` (+ 2 FKs) | `AttendanceRecord(TimestampMixin, AuditMixin)` |
| `announcements` | `author_id` `NOT NULL` → `NULL`; + FK `fk_announcements_author` (SET NULL) | ORM `author_id` nullable, `ondelete=SET NULL` |
| `announcements` | + FK `fk_announcements_class` (CASCADE) + `CHECK((audience='class') = (class_id IS NOT NULL))` | ORM FK + `ck_announcements_class_audience` |
| `announcements` | + `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by` + 3 list indexes | `Announcement(TimestampMixin, AuditMixin, SoftDeleteMixin)` |
| `announcement_reads` | **PK** `(announcement_id)` → `(announcement_id, user_id)`; + both FKs (CASCADE) + `ix_announcement_reads_user` | ORM composite PK + FKs |
| `report_card_snapshots` | + FKs `student_id`, `semester_id` (RESTRICT) + `UNIQUE(student_id, semester_id)` + timestamps | `ReportCardSnapshot(TimestampMixin)` + ORM FKs/unique |
| `term_grade_snapshots` | + FKs `student_id`, `class_subject_id`, `semester_id`, `subject_id` (RESTRICT) + `ix_term_snapshot_student` + timestamps | `TermGradeSnapshot(TimestampMixin)` + ORM FKs — sims had **none** |
| `events` | **NEW TABLE** (id, title, description, category, visibility, start/end_date, all_day, start/end_time, location, created_by_user_id FK, timestamps) | Frontend `DemoEvent` + `handlers/events.ts` calendar module (no ORM model yet) |

## Legacy tables / columns (unused by the new model — leave or drop)

These are remnants of the previous SQL-Server-style schema. The script does **not**
drop anything; recommendations below.

| Object | Status | Recommendation |
|---|---|---|
| table `students` | Legacy — replaced by `student_profiles` | **Leave** until data is migrated/verified, then drop. No new-model reference. |
| table `staff` | Legacy — replaced by `teacher_profiles` (+ `users`) | **Leave**, then drop after migration. |
| table `grades` | Legacy — replaced by `assessment_grades` / `term_grade_snapshots` | **Leave**, then drop after migration. |
| table `cat_assessment` | Legacy — replaced by `assessment_categories` | **Leave**, then drop after migration. |
| `academic_years.yearID` | Legacy int surrogate; ORM uses the `uuid id` | **Leave** (now nullable so it won't block inserts); drop once nothing reads it. |
| `academic_years.YEAR` | Legacy int; not in the ORM | **Leave** (now nullable); drop later. |
| `classes.classStaffID` | Legacy int homeroom-staff pointer; superseded by `class_teachers` | **Leave** (now nullable); drop later. |
| `classes.numStudents` | Legacy denormalized count; ORM derives from enrollments | **Leave** (has default 0); drop later. |
| `subjects.category` | Legacy; not in the ORM `Subject` | **Leave** (now nullable); drop later. |
| `subjects.elective` | Legacy `bit(1)`; not in the ORM | **Leave**; drop later. |
| `assessment_grades.max_score` | Extra col not in the ORM (assessment already carries `max_score`) | **Leave** (now nullable). If the reporting layer wants a frozen per-grade ceiling, keep and have the service populate it; otherwise drop. |
| `student_profiles.is_active_number`, `subjects.is_active`/`unique_code`, `users.active_username`/`active_email`, `academic_years.active_flag`, `semesters.active_unique_helper`, `classes.active_class_name`, `class_subjects.cs_active_subject`, `class_enrollments.enroll_active_flag`, `teacher_profiles.is_active` | **Keep** — these are the generated helper columns that emulate Postgres partial-unique indexes. Not application data; do not drop. |

## Caveats / human decisions needed

1. **`student_profiles.enrollment_date` → NOT NULL** and **`assessments` enum value
   changes** assume the affected tables are empty (they are, ~0 rows). On a populated
   DB you must backfill `enrollment_date` and remap any `'Exam'/'Quiz'/'Assignment'`
   and `'archived'` values **before** running those `MODIFY`s, or they will fail/coerce.
2. **`teacher_profiles` extended fields, `classes.homeroom_label`, `school_profile`
   colors, and the `events` table** satisfy the **frontend** contract but have **no ORM
   model** yet. Add matching SQLAlchemy models/columns (or an `events` module) so
   Alembic autogenerate and the real API stay in sync — otherwise the backend can't
   read/write them.
3. **`assessment_grades.max_score`** — confirm with the team whether to keep
   (service-populated) or drop. Currently made nullable so ORM inserts succeed.
4. **AuditMixin FKs are self-referential to `users`** (`created_by`/`updated_by`), added
   with `ON DELETE SET NULL`, consistent with the mixin definition.
5. **Enum/collation:** the DB collation is case-insensitive (`utf8mb4_uca1400_ai_ci`),
   which already gives the CITEXT-like behavior the ORM expects for `email`/`username`.
   MariaDB enum labels are compared case-insensitively too; the app always sends the
   lowercase wire labels, so the new enum definitions are the canonical set.

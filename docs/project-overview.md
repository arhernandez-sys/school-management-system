# Project Overview — School Management System (SIS)

> Owner: Project Orchestrator. This document is stable across phases. It defines *what* we are building and the fixed constraints. Detailed decisions live in the phase-specific docs.

## 1. Purpose

A modern, web-based **School Management System (Student Information System / SIS)** that centralizes the academic and administrative operations of a school: student records, teaching staff, classes, assessments, grading, attendance, announcements, and reporting.

## 2. Target Users (Roles)

| Role | Description |
|------|-------------|
| **Principal** | School administrator with the broadest oversight: full visibility into all modules, analytics, staff and student management, school-wide announcements and reports. |
| **Secretary** | Administrative operator: manages enrollment, student/teacher records, class setup, scheduling, and day-to-day data entry. |
| **Teacher** | Manages their own classes: records attendance, creates assessments, enters grades, posts class announcements, views their students. |
| **Student** | Consumes their own academic data: schedule, grades, attendance, assessments/assignments, and announcements. |

## 3. Fixed Technology Stack

| Concern | Technology |
|---------|-----------|
| UI framework | **React** |
| Language | **TypeScript** |
| Component library | **Material UI (MUI)** |
| Routing | **React Router** |
| Server state / data fetching | **TanStack Query** |
| Charts / data viz | **Recharts** |

> Backend/persistence technology is **not yet fixed** — to be decided in Phase 2 (Architecture). The API contract (Phase 5) will be defined so the frontend can be built against it regardless.

## 4. Functional Modules

1. Authentication
2. Dashboard (role-aware)
3. Students
4. Teachers
5. Classes
6. Assessments
7. Grades
8. Attendance
9. Announcements
10. Reports
11. Settings
12. **Calendar / Events** — _scope addition, 2026-07. Not in the original charter._
    Added because the shipped frontend already contains a complete calendar
    (`features/calendar/`: `CalendarPage`, `MonthCalendar`, `EventFormDialog`,
    `EventDetailDialog`, a nav item, a route and a `PERMISSION_MATRIX.calendar` entry),
    MSW had `handlers/events.ts` wired in, and the `events` table has existed in
    MariaDB since `db/mariadb/001_missing_fields.sql`. Without a backend, `/calendar`
    was a dead route in the real app. Recorded here rather than shipped silently.
    Contract: `api-specification.md` §5.0 Module 12; requirements: FR-CAL-01..05.

## 5. Documentation Map (Source of Truth)

| Document | Phase | Status |
|----------|-------|--------|
| `project-overview.md` | — | ✅ Stable |
| `requirements.md` | 1 | ✅ Complete |
| `architecture.md` | 2 | ✅ Complete |
| `ui-design-system.md` | 3 | ✅ Complete |
| `database-schema.md` | 4 | ✅ Complete (OQ-DB2 resolved 2026-07-28, §10.3) |
| `api-specification.md` | 5 | ✅ Complete (reconciled to the shipped backend 2026-07-28, §5.0a) |
| `frontend-implementation.md` | 6–7 | ✅ Complete — frontend finished |
| `testing-plan.md` | 8 | ⬜ Pending — but the backend suite is live (see tracker) |
| `security-review.md` | 9 | ⬜ Pending |
| `progress-tracker.md` | all | ✅ Live |

> **Backend surface is authoritative in `backend/openapi.json`** (regenerated
> 2026-07-28): 70 path templates / 99 operations. Phase 7 is complete.

## 6. Orchestration Principles

- Execute **one phase at a time**; do not build ahead.
- Every specialist agent **reads the relevant docs before contributing**.
- Every phase **ends by updating `progress-tracker.md`**.
- Documentation is the project's memory and the source of truth for all future work.

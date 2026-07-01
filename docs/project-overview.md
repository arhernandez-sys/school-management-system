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

## 5. Documentation Map (Source of Truth)

| Document | Phase | Status |
|----------|-------|--------|
| `project-overview.md` | — | ✅ Stable |
| `requirements.md` | 1 | ✅ Complete |
| `architecture.md` | 2 | ✅ Complete |
| `ui-design-system.md` | 3 | ✅ Complete |
| `database-schema.md` | 4 | ✅ Complete |
| `api-specification.md` | 5 | ✅ Complete |
| `frontend-implementation.md` | 6–7 | 🟡 Foundation done (Phase 6); modules pending (Phase 7) |
| `testing-plan.md` | 8 | ⬜ Pending |
| `security-review.md` | 9 | ⬜ Pending |
| `progress-tracker.md` | all | ✅ Live |

## 6. Orchestration Principles

- Execute **one phase at a time**; do not build ahead.
- Every specialist agent **reads the relevant docs before contributing**.
- Every phase **ends by updating `progress-tracker.md`**.
- Documentation is the project's memory and the source of truth for all future work.

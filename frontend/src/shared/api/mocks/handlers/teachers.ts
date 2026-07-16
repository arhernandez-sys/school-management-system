import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  classSubjectsOwnedByTeacher,
  getSection,
  getSubject,
  getTeacher,
  listTeachers,
  rosterFor,
  sectionsOwnedByTeacher,
} from '@shared/api/mocks/demo/dataset';
import type { DemoClassSubject, DemoTeacher, DemoUser } from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the TEACHERS module (api-spec §5 Module 4) — DEMO.
 *
 * Backs the Teachers directory + detail + admin CRUD entirely against the shared
 * in-memory dataset (no backend). Response shapes mirror api-spec §5.4:
 *  - GET    /teachers            → Page[TeacherListItem]  (search + status + specialization)
 *  - GET    /teachers/{id}       → TeacherDetail          (profile + classes_taught + audit)
 *  - POST   /teachers            → TeacherDetail (201); optional create_login returns the
 *                                  one-time temporary_password on the wrapper envelope.
 *  - PATCH  /teachers/{id}       → TeacherDetail          (benign profile edits)
 *  - POST   /teachers/{id}/status→ TeacherDetail          (activate/deactivate; 409 if the
 *                                  teacher still has active assignments)
 *  - DELETE /teachers/{id}       → 204                    (409 if assigned; FK RESTRICT)
 *
 * Wire format is snake_case; the demo mutates DEMO_DATASET in-session so creates/edits
 * persist across screens until reload. Do NOT touch handlers/index.ts.
 */
const D = DEMO_DATASET;

// ── Response shapers (map internal rows → api-spec shapes) ─────────────────────

function toListItem(t: DemoTeacher) {
  return {
    id: t.id,
    staff_number: t.staff_number,
    full_name: t.full_name,
    email: t.email,
    status: t.status,
    subject_specializations: t.subject_specializations,
    /** Convenience count for the directory table (#assignments). */
    assignment_count: classSubjectsOwnedByTeacher(t.id).length,
  };
}

/** A class_subject the teacher is assigned to, resolved to section + subject refs. */
function toClassTaught(cs: DemoClassSubject, teacherId: string) {
  const section = getSection(cs.section_id);
  const subject = getSubject(cs.subject_id);
  return {
    class_subject_id: cs.id,
    class_ref: section
      ? { id: section.id, name: section.name, grade_level: section.grade_level }
      : null,
    subject: subject ? { id: subject.id, name: subject.name, code: subject.code } : null,
    is_lead: cs.lead_teacher_id === teacherId,
    is_active: cs.is_active,
  };
}

/** Distinct students across every section this teacher owns a subject in. */
function studentCountForTeacher(teacherId: string): number {
  const ids = new Set<string>();
  for (const section of sectionsOwnedByTeacher(teacherId)) {
    for (const student of rosterFor(section.id)) ids.add(student.id);
  }
  return ids.size;
}

function toDetail(t: DemoTeacher) {
  const owned = classSubjectsOwnedByTeacher(t.id);
  return {
    id: t.id,
    user_id: t.user_id,
    staff_number: t.staff_number,
    full_name: t.full_name,
    email: t.email,
    phone: t.phone,
    status: t.status,
    subject_specializations: t.subject_specializations,
    has_login: t.user_id !== null,
    classes_taught: owned.map((cs) => toClassTaught(cs, t.id)),
    audit: { created_at: DEMO_TODAY_ISO, updated_at: DEMO_TODAY_ISO },
    // Extended profile (optional; may be undefined for freshly created teachers).
    avatar_url: t.avatar_url,
    bio: t.bio,
    gender: t.gender,
    education: t.education,
    designation: t.designation,
    address: t.address,
    expertise: t.expertise,
    student_count: studentCountForTeacher(t.id),
  };
}

/** Active class_subjects (is_active) this teacher is assigned to — blocks deactivate/delete. */
function activeAssignmentsOf(teacherId: string): DemoClassSubject[] {
  return classSubjectsOwnedByTeacher(teacherId).filter((cs) => cs.is_active);
}

function assignmentRefs(assignments: DemoClassSubject[]) {
  return assignments.map((cs) => {
    const section = getSection(cs.section_id);
    const subject = getSubject(cs.subject_id);
    return {
      class_subject_id: cs.id,
      class_name: section?.name ?? null,
      subject_name: subject?.name ?? null,
    };
  });
}

let teacherSeq = 100;

// ── Handlers ────────────────────────────────────────────────────────────────────

export const teachersHandlers = [
  // GET /teachers — searchable directory (Page[TeacherListItem]). Teacher = RO; Student → 403.
  http.get(`${API_BASE_URL}/teachers`, ({ request }) => {
    const url = new URL(request.url);
    const page = listTeachers({
      ...listParamsFrom(url),
      status: url.searchParams.get('status'),
      specialization: url.searchParams.get('specialization'),
      // Per-module year switcher: restrict to teachers assigned in the chosen year.
      academic_year_id: url.searchParams.get('academic_year_id'),
    });
    return HttpResponse.json({ ...page, items: page.items.map(toListItem) });
  }),

  // GET /teachers/{id} — TeacherDetail (profile + classes_taught + audit).
  http.get(`${API_BASE_URL}/teachers/:teacherId`, ({ params }) => {
    const teacher = getTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, 'not_found', 'Teacher not found.');
    return HttpResponse.json(toDetail(teacher));
  }),

  // POST /teachers — create profile; optional create_login provisions a linked account
  // and returns a one-time temporary_password on the wrapper envelope.
  http.post(`${API_BASE_URL}/teachers`, async ({ request }) => {
    const body = (await request.json()) as {
      staff_number: string;
      full_name: string;
      email?: string | null;
      phone?: string | null;
      status?: DemoTeacher['status'];
      subject_specializations?: string[] | null;
      create_login?: { email: string; role: 'teacher' } | null;
    };

    const staffNumber = (body.staff_number ?? '').trim();
    const fullName = (body.full_name ?? '').trim();
    if (!staffNumber || !fullName) {
      return errorResponse(422, 'validation_error', 'Staff number and full name are required.', {
        ...(staffNumber ? {} : { staff_number: ['Required.'] }),
        ...(fullName ? {} : { full_name: ['Required.'] }),
      });
    }
    if (D.teachers.some((t) => t.staff_number.toLowerCase() === staffNumber.toLowerCase())) {
      return errorResponse(409, 'duplicate_staff_number', 'A teacher with this staff number already exists.');
    }
    const email = (body.email ?? '').trim();
    if (email && D.teachers.some((t) => t.email.toLowerCase() === email.toLowerCase())) {
      return errorResponse(409, 'duplicate_email', 'A teacher with this email already exists.');
    }

    teacherSeq += 1;
    const id = `teacher-new-${teacherSeq}`;

    // Optional linked login account (admin-provisioned, D5). Emits a one-time temp password.
    let userId: string | null = null;
    let temporaryPassword: string | null = null;
    if (body.create_login) {
      const loginEmail = body.create_login.email.trim();
      if (D.users.some((u) => u.email.toLowerCase() === loginEmail.toLowerCase())) {
        return errorResponse(409, 'duplicate_email', 'An account with this email already exists.');
      }
      teacherSeq += 1;
      userId = `user-new-${teacherSeq}`;
      temporaryPassword = `Temp-${staffNumber.replace(/\s+/g, '')}-${teacherSeq}`;
      const user: DemoUser = {
        id: userId,
        email: loginEmail,
        username: null,
        full_name: fullName,
        role: 'teacher',
        is_active: true,
        must_change_password: true,
        last_login_at: null,
        locale: 'en',
        theme: 'light',
        date_format: null,
        default_page_size: 25,
      };
      D.users.push(user);
    }

    const created: DemoTeacher = {
      id,
      user_id: userId,
      staff_number: staffNumber,
      full_name: fullName,
      email,
      phone: (body.phone ?? '').trim(),
      subject_specializations: body.subject_specializations ?? [],
      status: body.status ?? 'active',
    };
    D.teachers.push(created);

    return HttpResponse.json(
      { teacher: toDetail(created), temporary_password: temporaryPassword },
      { status: 201 },
    );
  }),

  // PATCH /teachers/{id} — benign profile edits (NOT status; NOT role).
  http.patch(`${API_BASE_URL}/teachers/:teacherId`, async ({ params, request }) => {
    const teacher = getTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, 'not_found', 'Teacher not found.');
    const body = (await request.json()) as {
      full_name?: string;
      email?: string | null;
      phone?: string | null;
      subject_specializations?: string[] | null;
      bio?: string | null;
      gender?: DemoTeacher['gender'] | null;
      education?: string | null;
      designation?: string | null;
      address?: string | null;
      expertise?: { area: string; level: number }[] | null;
    };

    if (body.full_name !== undefined && body.full_name.trim().length === 0) {
      return errorResponse(422, 'validation_error', 'Full name cannot be empty.', {
        full_name: ['Required.'],
      });
    }
    const email = body.email?.trim();
    if (
      email &&
      D.teachers.some(
        (t) => t.id !== teacher.id && t.email.toLowerCase() === email.toLowerCase(),
      )
    ) {
      return errorResponse(409, 'duplicate_email', 'A teacher with this email already exists.');
    }

    if (body.full_name !== undefined) teacher.full_name = body.full_name.trim();
    if (body.email !== undefined) teacher.email = (body.email ?? '').trim();
    if (body.phone !== undefined) teacher.phone = (body.phone ?? '').trim();
    if (body.subject_specializations !== undefined) {
      teacher.subject_specializations = body.subject_specializations ?? [];
    }
    // Extended profile edits (all optional; empty strings clear the field).
    if (body.bio !== undefined) teacher.bio = (body.bio ?? '').trim() || undefined;
    if (body.gender !== undefined) teacher.gender = body.gender ?? undefined;
    if (body.education !== undefined) teacher.education = (body.education ?? '').trim() || undefined;
    if (body.designation !== undefined)
      teacher.designation = (body.designation ?? '').trim() || undefined;
    if (body.address !== undefined) teacher.address = (body.address ?? '').trim() || undefined;
    if (body.expertise !== undefined) {
      teacher.expertise = (body.expertise ?? [])
        .map((e) => ({
          area: e.area.trim(),
          level: Math.max(0, Math.min(100, Math.round(e.level))),
        }))
        .filter((e) => e.area.length > 0);
    }
    return HttpResponse.json(toDetail(teacher));
  }),

  // POST /teachers/{id}/status — activate/deactivate. Deactivating a teacher who still
  // has active assignments is blocked (409 teacher_has_active_assignments).
  http.post(`${API_BASE_URL}/teachers/:teacherId/status`, async ({ params, request }) => {
    const teacher = getTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, 'not_found', 'Teacher not found.');
    const body = (await request.json()) as { status: DemoTeacher['status'] };

    if (body.status === 'inactive') {
      const active = activeAssignmentsOf(teacher.id);
      if (active.length > 0) {
        return errorResponse(
          409,
          'teacher_has_active_assignments',
          'This teacher is still assigned to active classes. Reassign those classes before deactivating.',
          { assignments: assignmentRefs(active).map((a) => `${a.class_name} · ${a.subject_name}`) },
        );
      }
    }
    teacher.status = body.status;
    return HttpResponse.json(toDetail(teacher));
  }),

  // DELETE /teachers/{id} — hard delete; blocked if assigned to any active class_subject.
  http.delete(`${API_BASE_URL}/teachers/:teacherId`, ({ params }) => {
    const teacher = getTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, 'not_found', 'Teacher not found.');
    const active = activeAssignmentsOf(teacher.id);
    if (active.length > 0) {
      return errorResponse(
        409,
        'teacher_has_active_assignments',
        'This teacher is assigned to one or more active classes and cannot be deleted. Reassign or deactivate those classes first.',
        { assignments: assignmentRefs(active).map((a) => `${a.class_name} · ${a.subject_name}`) },
      );
    }
    D.teachers = D.teachers.filter((t) => t.id !== teacher.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FamilyRestroomOutlinedIcon from '@mui/icons-material/FamilyRestroomOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SchoolIcon from '@mui/icons-material/School';
import ContactEmergencyOutlinedIcon from '@mui/icons-material/ContactEmergencyOutlined';
import MedicalInformationOutlinedIcon from '@mui/icons-material/MedicalInformationOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import type { ReactNode } from 'react';
import {
  ProfileAvatar,
  ProfileSectionHeading as SectionHeading,
  ProfileStatTile as StatTile,
  StatusBadge,
} from '@shared/components';
import type { StatCardColor } from '@shared/components';
import { genderLabel } from '@shared/types/enums';
import { STUDENT_STATUS_KIND, STUDENT_STATUS_LABEL } from '../constants';
import type { StudentDetail } from '../types';

/** Whole years between `dob` and today; `null` for a missing/invalid/implausible date. */
function ageFrom(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** A single label/value row in the definition-list sections. */
function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

/** A divider-separated definition-list section with an iconed heading. */
function InfoSection({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <SectionHeading icon={icon}>{title}</SectionHeading>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          rowGap: 1,
          columnGap: 2,
          m: 0,
          mt: 1,
        }}
      >
        {rows.map((r) => (
          <InfoRow key={r.label} label={r.label} value={r.value} />
        ))}
      </Box>
    </>
  );
}

/**
 * Drop the rows whose value is empty. `false` is KEPT — "Sat the ATLIB exam: No" is an
 * answer, and the absence of that line would read as "not asked" instead.
 */
type Row = { label: string; value: ReactNode };
function present(rows: Array<Row | null | false>): Row[] {
  return rows.filter((r): r is Row => {
    if (!r) return false;
    const v = r.value;
    return v !== null && v !== undefined && v !== '';
  });
}

/** `"Yes"` / `"No"` — a tick-box on the paper form, and it prints as a word here. */
const yesNo = (v: boolean | null | undefined) => (v ? 'Yes' : 'No');

export interface StudentProfileSummaryProps {
  student: StudentDetail;
}

/**
 * StudentProfileSummary — the left "identity" card of the student profile, the counterpart to
 * {@link TeacherProfileSummary} and built from the same {@link ProfileParts} so the two profiles
 * read as one system.
 *
 * A soft-shadow Card led by a palette-tinted gradient banner: a ringed {@link ProfileAvatar}
 * overlaps the band, then name + "Student #" + status/year-group chips, then divider-separated
 * sections (Statistics · Personal Information · Guardian · Address). Statistics are honest facts
 * derived from the record (age from date of birth, year group, how many subject classes) — never
 * fabricated; the whole section is omitted when none apply. Sections omit when their data is
 * empty, keeping the card compact for sparse profiles.
 */
export function StudentProfileSummary({ student }: StudentProfileSummaryProps) {
  const offeringCount = student.current_offerings?.length ?? 0;
  const age = student.date_of_birth ? ageFrom(student.date_of_birth) : null;

  // D29: the old Grade + Section tiles were read off the student's ONE homeroom. The year
  // of study is now the student's own field, and "how many courses" replaces the section
  // letter — the offerings themselves are listed by StudentEnrollmentPanel, so repeating
  // their names here would just duplicate that card.
  const stats: Array<{ label: string; value: ReactNode; color: StatCardColor; icon: ReactNode }> = [
    ...(age !== null
      ? [{ label: 'Age', value: age, color: 'primary' as StatCardColor, icon: <CakeOutlinedIcon fontSize="small" /> }]
      : []),
    ...(student.year_of_study
      ? [
          {
            label: 'Year of study',
            value: student.year_of_study,
            color: 'secondary' as StatCardColor,
            icon: <SchoolOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
    ...(offeringCount > 0
      ? [
          {
            label: offeringCount === 1 ? 'Course' : 'Courses',
            value: offeringCount,
            color: 'info' as StatCardColor,
            icon: <ClassOutlinedIcon fontSize="small" />,
          },
        ]
      : []),
  ];

  /*
   * D33 (client ask 4) — the profile shows EVERYTHING on the record, documents excepted.
   *
   * Before this it showed eleven fields, which was every field the old create form wrote.
   * The record itself has carried the whole admission form since `005_tertiary.sql`, so a
   * student admitted through admissions had a next of kin, a financier and a religion that
   * no screen anywhere displayed — and D32's Religion filter selected on one of them. Every
   * value the directory can filter by is now here, which is the client's specific test.
   *
   * Sections still omit themselves when empty (`present`), so a sparse paper registration
   * does not render as a wall of em-dashes. The exception is `Registration`, whose fields
   * are the ones a Registrar comes to this card to check.
   */
  const registrationRows = present([
    { label: 'Student #', value: student.student_number },
    {
      label: 'Programme',
      value: student.program ? `${student.program.code} — ${student.program.name}` : '—',
    },
    { label: 'Year of study', value: student.year_of_study || '—' },
    { label: 'Study load', value: student.enrollment_load || '—' },
    { label: 'Enrolled', value: student.enrollment_date || '—' },
    { label: 'Status', value: STUDENT_STATUS_LABEL[student.status] },
    // Only for a student who came through admissions; a paper registration has none, and
    // the row is dropped rather than saying "none".
    student.application_id ? { label: 'Admitted from', value: 'Application on file' } : null,
    // ── D34 · the client's own record-keeping columns ────────────────────────
    // Each is dropped when empty, so a plain registration shows none of them and a
    // transfer / graduate / drop-out shows exactly the ones that apply to it.
    { label: 'Transferred from', value: student.transferred_from },
    { label: 'Graduated', value: student.graduation_date },
    { label: 'Left on', value: student.dropout_date?.slice(0, 10) ?? null },
    { label: 'Reason for leaving', value: student.dropout_reason },
    { label: 'Original ID', value: student.student_id_original?.toString() ?? null },
    { label: 'Record origin', value: student.origin },
  ]);

  // Free text, so it gets its own block rather than a definition-list row that would
  // wrap awkwardly in a 35%-width column.
  const comments = student.comments?.trim() || null;

  const personalRows = present([
    { label: 'Date of birth', value: student.date_of_birth || '—' },
    // D37 — `genderLabel`, not a ternary. `gender === 'female' ? 'Female' : 'Male'`
    // showed "Male" for a stored 'Female' (capital F falls to the else branch) and for
    // any other value too. Live data already had 'Male' on the applications table.
    { label: 'Gender', value: genderLabel(student.gender) },
    { label: 'Civil status', value: student.civil_status },
    // Filterable in the directory (D32), so it has to be visible here.
    { label: 'Religion', value: student.religion },
    { label: 'Social Security no.', value: student.ssno },
    { label: 'Phone', value: student.phone },
    // D34 — the student's OWN address (their contact), then the LOGIN separately. Before
    // D34 there was one field and it was the login, so a paper registration showed no
    // email at all even when the office had one on the form.
    { label: 'E-mail', value: student.email },
    { label: 'Login', value: student.login_email },
  ]);

  const familyRows = present([
    { label: "Mother's name", value: student.mother_name },
    { label: "Father's name", value: student.father_name },
    { label: 'Next of kin', value: student.nok_name },
    { label: 'Relationship', value: student.nok_relationship },
    { label: 'NOK phone', value: student.nok_phone },
  ]);

  const guardianRows = present([
    { label: 'Name', value: student.guardian_name },
    { label: 'Phone', value: student.guardian_phone },
    { label: 'Email', value: student.guardian_email },
  ]);

  // The tick-box drives the section: an un-ticked record shows "No" and nothing else, and
  // a ticked one without a note still shows the tick — that is a real state on the form.
  const healthRows = present([
    { label: 'Condition declared', value: yesNo(student.has_health_condition) },
    student.has_health_condition ? { label: 'Details', value: student.health_condition_note } : null,
  ]);

  const examRows = present([
    { label: 'ATLIB exam', value: yesNo(student.atlib_exam) },
    { label: 'CSEC exams', value: student.num_csec == null ? null : String(student.num_csec) },
  ]);

  const financeRows = present([
    { label: 'Name', value: student.finance_name },
    { label: 'Phone', value: student.finance_phone },
    { label: 'Email', value: student.finance_email },
  ]);

  // The three structured parts, then the free-text mailing address underneath — they are
  // not the same field and neither composes into the other.
  const addressRows = present([
    { label: 'Street', value: student.street },
    { label: 'Village / town', value: student.city_town_village },
    { label: 'District', value: student.district },
  ]);

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {/* Palette-tinted banner behind the identity header (decorative). */}
      <Box
        aria-hidden
        sx={(theme) => ({
          height: 88,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.16)}, ${alpha(
            theme.palette.secondary.main,
            0.16,
          )})`,
        })}
      />
      <CardContent sx={{ mt: '-44px' }}>
        {/* Identity header — avatar overlaps the banner. */}
        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <ProfileAvatar name={student.full_name} />
          <Box>
            <Typography variant="h6" component="h2">
              {student.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Student # {student.student_number}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
            <StatusBadge
              label={STUDENT_STATUS_LABEL[student.status]}
              kind={STUDENT_STATUS_KIND[student.status]}
            />
            {/* D29: the header chip names the student's LEVEL, not a homeroom — they no
                longer have one class that identifies them. */}
            {student.year_of_study && <StatusBadge label={student.year_of_study} kind="info" />}
          </Stack>
        </Stack>

        {/* Statistics — honest facts only (age / year group / class count). */}
        {stats.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<InsightsOutlinedIcon fontSize="small" />}>Statistics</SectionHeading>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
                gap: 1,
                mt: 1,
              }}
            >
              {stats.map((s) => (
                <StatTile key={s.label} icon={s.icon} value={s.value} label={s.label} color={s.color} />
              ))}
            </Box>
          </>
        )}

        {/* Registration — programme, level, load, status. What a Registrar opens this
            card to check, so it leads and never omits itself. */}
        {registrationRows.length > 0 && (
          <InfoSection
            icon={<SchoolIcon fontSize="small" />}
            title="Registration"
            rows={registrationRows}
          />
        )}

        {/* Personal Information */}
        {personalRows.length > 0 && (
          <InfoSection
            icon={<BadgeOutlinedIcon fontSize="small" />}
            title="Personal Information"
            rows={personalRows}
          />
        )}

        {/* Address — the structured parts, then the printed mailing line. */}
        {(addressRows.length > 0 || student.address) && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<PlaceOutlinedIcon fontSize="small" />}>Address</SectionHeading>
            {addressRows.length > 0 && (
              <Box
                component="dl"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  rowGap: 1,
                  columnGap: 2,
                  m: 0,
                  mt: 1,
                }}
              >
                {addressRows.map((r) => (
                  <InfoRow key={r.label} label={r.label} value={r.value} />
                ))}
              </Box>
            )}
            {student.address && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: addressRows.length > 0 ? 1.5 : 1, wordBreak: 'break-word' }}
              >
                {student.address}
              </Typography>
            )}
          </>
        )}

        {/* Family and next of kin — distinct from the guardian below: the guardian is
            who the school corresponds with, which is not always a parent. */}
        {familyRows.length > 0 && (
          <InfoSection
            icon={<ContactEmergencyOutlinedIcon fontSize="small" />}
            title="Family & next of kin"
            rows={familyRows}
          />
        )}

        {/* Guardian */}
        {guardianRows.length > 0 && (
          <InfoSection
            icon={<FamilyRestroomOutlinedIcon fontSize="small" />}
            title="Guardian"
            rows={guardianRows}
          />
        )}

        {/* Health */}
        {healthRows.length > 0 && (
          <InfoSection
            icon={<MedicalInformationOutlinedIcon fontSize="small" />}
            title="Health"
            rows={healthRows}
          />
        )}

        {/* Prior examinations */}
        {examRows.length > 0 && (
          <InfoSection
            icon={<FactCheckOutlinedIcon fontSize="small" />}
            title="Prior examinations"
            rows={examRows}
          />
        )}

        {/* Registrar's notes — last, and never shown to the student (the whole card is
            staff-only; `MyStudentProfilePage` is the student's own view). */}
        {comments && (
          <>
            <Divider sx={{ my: 2 }} />
            <SectionHeading icon={<NotesOutlinedIcon fontSize="small" />}>Notes</SectionHeading>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {comments}
            </Typography>
          </>
        )}

        {/* Who finances the study */}
        {financeRows.length > 0 && (
          <InfoSection
            icon={<PaymentsOutlinedIcon fontSize="small" />}
            title="Financial information"
            rows={financeRows}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default StudentProfileSummary;

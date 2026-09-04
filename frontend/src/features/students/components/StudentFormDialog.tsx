import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormDialog, DateField } from '@shared/components';
import { schoolToday } from '@shared/utils/schoolDate';
import { strings } from '@i18n/strings';
import {
  DISTRICTS,
  ENROLLMENT_LOADS,
  GENDERS,
  GENDER_LABEL,
  canonicalGender,
  canonicalCivilStatus,
  civilStatusOptions,
} from '@shared/types/enums';
import type { District, EnrollmentLoad } from '@shared/types/enums';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import { useReligions, religionOptions } from '@features/settings/hooks/useReligions';
import type { StudentDetail, StudentWritePayload, YearOfStudy } from '../types';
import { useOfferingOptions, YEAR_OF_STUDY_OPTIONS } from '../hooks/useOfferingOptions';

export interface StudentFormDialogProps {
  open: boolean;
  /** Edit mode when provided (create otherwise). */
  student?: StudentDetail | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: StudentWritePayload) => void;
  onClose: () => void;
}

/** A labelled band, matching the `Divider textAlign="left"` rhythm of the wizard. */
function SectionBand({ children }: { children: string }) {
  return (
    <Divider textAlign="left" sx={{ pt: 1 }}>
      <Typography variant="overline">{children}</Typography>
    </Divider>
  );
}

/** The three-across row the wizard uses throughout; stacks below `sm`. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      {children}
    </Stack>
  );
}

/**
 * Create / edit a student — **the application form, for a student record** (D33, client
 * ask 3; api-spec §5.3).
 *
 * **What this replaced, and why.** The old dialog collected eleven fields: names, two
 * dates, gender, level, guardian, address, phone. The BAJC application collects far more,
 * and every one of those columns has existed on `student_profiles` since
 * `005_tertiary.sql` — acceptance copies them across. The result was a two-tier register:
 * a student admitted THROUGH admissions had a next of kin, a financier and a religion; one
 * registered directly, or predating the system, had permanently blank ones with no screen
 * anywhere to fill them in. The D32 Religion filter made that visible, since it selected
 * on a column the Registrar could not see. So the form now mirrors the paper document, and
 * the same component serves create and edit — the edit button opens the identical form,
 * pre-filled.
 *
 * **Sections, not a wizard.** The application wizard is seven steps because it SAVES AT
 * EVERY STEP: the Registrar transcribes a paper form over an interrupted afternoon, and a
 * `draft` application is a real server-side state. A student record has no draft state —
 * one `POST` creates it or nothing does — so a stepper would add an all-or-nothing gauntlet
 * with none of the interruption-safety that justifies it upstream. The section headings and
 * field order are the wizard's, so the two read as one document; the layout is one scroll.
 *
 * Deliberately absent, and each for its own reason:
 *
 * * **Documents** — the client excluded them, and there are no file bytes anywhere
 *   (OQ-DB5); Section F is a tick-list on the application.
 * * **Prior education / credit transfer** — anchored on the APPLICATION by policy (§D4,
 *   brief §13), never on the student.
 * * **The LOGIN e-mail** — read-only. It lives on the linked `users` row and changing it
 *   has its own uniqueness rules in the Users module. The student's OWN e-mail is a
 *   different field and IS editable here (D34 added the column; see `types.ts`).
 * * **Programme, on EDIT only** — assignable at registration, but changing it must move
 *   `student_program_history` in the same transaction, which is the Dean-only
 *   `PUT /students/{id}/program` (§D12). Shown read-only here with that pointer, rather
 *   than as a field that would silently write the column and leave the history behind.
 * * **Enrolment, on EDIT only** — the API rejects `offering_ids` on PATCH: with many
 *   enrolments, "set them from here" is ambiguous about removals. Changes live under
 *   Course Offerings → Roster.
 * * **Status** — lifecycle goes through `POST /students/{id}/status`, which is auditable.
 *
 * **D30 notes that still hold.** Names are entered in PARTS because that is how they are
 * stored and sorted (§D10), surname first since that is what the register orders on. The
 * STUDENT ID IS OPTIONAL: left blank, the server issues the next `YYYYMM###` (§D9), and it
 * is only typed in to import a student who already carries one. `year_of_study` is a SELECT
 * because it is `enum('First','Second')` server-side — a typed "Lower 6" was silently
 * truncated on write.
 *
 * A 409 `duplicate_student_number` is surfaced by the parent.
 */
export function StudentFormDialog({
  open,
  student,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: StudentFormDialogProps) {
  const editing = Boolean(student);
  // Both pickers are only needed by the CREATE form — enrolment and programme are
  // read-only on edit — so neither query is issued in that case.
  const offeringsQuery = useOfferingOptions(open && !editing);
  const offeringOptions = useMemo(() => offeringsQuery.data ?? [], [offeringsQuery.data]);
  const programsQuery = useProgramsList(
    { page_size: 100, is_active: true },
    { enabled: open && !editing },
  );
  const programOptions = useMemo(() => programsQuery.data?.items ?? [], [programsQuery.data]);

  // ── Section A · identity ────────────────────────────────────────────────────
  const [studentNumber, setStudentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [ssno, setSsno] = useState('');
  // D37 — a plain string, not the narrowed union: a legacy row may hold a spelling the
  // dropdown does not offer, and typing it away does not make it not arrive.
  const [gender, setGender] = useState<string>('female');
  const [civilStatus, setCivilStatus] = useState('');
  const [religion, setReligion] = useState('');
  // D39 — the Religion vocabulary. `religionChoices` always contains the CURRENT value,
  // even when it predates the vocabulary; see `religionOptions`.
  const religions = useReligions();
  const religionChoices = useMemo(
    () => religionOptions(religions.data?.items, religion),
    [religions.data, religion],
  );
  // D40 — the same treatment for Civil status, which was free text until now. The list is
  // hardcoded rather than fetched because these four ARE the vocabulary; there is no
  // client-owned table behind them the way there is for religion.
  const civilStatusChoices = useMemo(() => civilStatusOptions(civilStatus), [civilStatus]);
  // ── Section A · address + contact ───────────────────────────────────────────
  const [street, setStreet] = useState('');
  const [cityTownVillage, setCityTownVillage] = useState('');
  const [district, setDistrict] = useState<District | ''>('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  // D34 — the student's OWN email, from the client's schema. Distinct from the login
  // (`student.login_email`), which is shown read-only further down.
  const [email, setEmail] = useState('');
  // ── Section A · family, next of kin, guardian ───────────────────────────────
  const [motherName, setMotherName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [nokName, setNokName] = useState('');
  const [nokRelationship, setNokRelationship] = useState('');
  const [nokPhone, setNokPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  // ── Section A · health ──────────────────────────────────────────────────────
  const [hasHealthCondition, setHasHealthCondition] = useState(false);
  const [healthConditionNote, setHealthConditionNote] = useState('');
  // ── Section B · examinations ────────────────────────────────────────────────
  const [atlibExam, setAtlibExam] = useState(false);
  const [numCsec, setNumCsec] = useState('');
  // ── Section C · who pays ────────────────────────────────────────────────────
  const [financeName, setFinanceName] = useState('');
  const [financePhone, setFinancePhone] = useState('');
  const [financeEmail, setFinanceEmail] = useState('');
  // ── Section E · programme of study ──────────────────────────────────────────
  const [programId, setProgramId] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState('');
  const [enrollmentLoad, setEnrollmentLoad] = useState<EnrollmentLoad | ''>('');
  // New enrollments default to the actual school-local today, not the demo dataset's
  // fixed date — otherwise every student created in production is stamped 2025-10-15.
  const [enrollmentDate, setEnrollmentDate] = useState(schoolToday());
  const [offeringIds, setOfferingIds] = useState<string[]>([]);
  // ── D34 · the rest of the client's columns ──────────────────────────────────
  const [studentIdOriginal, setStudentIdOriginal] = useState('');
  const [transferredFrom, setTransferredFrom] = useState('');
  const [graduationDate, setGraduationDate] = useState('');
  const [dropoutDate, setDropoutDate] = useState('');
  const [dropoutReason, setDropoutReason] = useState('');
  const [comments, setComments] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (!open) return;
    setStudentNumber(student?.student_number ?? '');
    setFirstName(student?.first_name ?? '');
    setMiddleName(student?.middle_name ?? '');
    setLastName(student?.last_name ?? '');
    setDateOfBirth(student?.date_of_birth ?? '');
    setSsno(student?.ssno ?? '');
    // Canonicalise on load, so a stored 'Male' selects the Male option instead of
    // rendering an empty select (and then clearing the field on save).
    setGender(canonicalGender(student?.gender) ?? 'female');
    // Canonicalised on load for the same reason `gender` is one line above: MariaDB's
    // collation cannot tell 'single' from 'Single', but the <select> can, and the
    // mismatched one renders blank and then saves that blank over a real value.
    setCivilStatus(canonicalCivilStatus(student?.civil_status) ?? student?.civil_status ?? '');
    setReligion(student?.religion ?? '');
    setStreet(student?.street ?? '');
    setCityTownVillage(student?.city_town_village ?? '');
    setDistrict(student?.district ?? '');
    setAddress(student?.address ?? '');
    setPhone(student?.phone ?? '');
    setMotherName(student?.mother_name ?? '');
    setFatherName(student?.father_name ?? '');
    setNokName(student?.nok_name ?? '');
    setNokRelationship(student?.nok_relationship ?? '');
    setNokPhone(student?.nok_phone ?? '');
    setGuardianName(student?.guardian_name ?? '');
    setGuardianPhone(student?.guardian_phone ?? '');
    setGuardianEmail(student?.guardian_email ?? '');
    setHasHealthCondition(student?.has_health_condition ?? false);
    setHealthConditionNote(student?.health_condition_note ?? '');
    setAtlibExam(student?.atlib_exam ?? false);
    setNumCsec(student?.num_csec == null ? '' : String(student.num_csec));
    setFinanceName(student?.finance_name ?? '');
    setFinancePhone(student?.finance_phone ?? '');
    setFinanceEmail(student?.finance_email ?? '');
    setProgramId(student?.program?.id ?? '');
    setYearOfStudy(student?.year_of_study ?? '');
    setEnrollmentLoad(student?.enrollment_load ?? '');
    setEnrollmentDate(student?.enrollment_date ?? schoolToday());
    setOfferingIds([]);
    setEmail(student?.email ?? '');
    setStudentIdOriginal(student?.student_id_original == null ? '' : String(student.student_id_original));
    setTransferredFrom(student?.transferred_from ?? '');
    setGraduationDate(student?.graduation_date ?? '');
    // `dropout_date` is a datetime on the wire; the input is a plain date, so only the
    // date half round-trips through this form. The time is preserved when untouched
    // because the field is only sent when it differs from what was loaded.
    setDropoutDate((student?.dropout_date ?? '').slice(0, 10));
    setDropoutReason(student?.dropout_reason ?? '');
    setComments(student?.comments ?? '');
    setOrigin(student?.origin ?? '');
  }, [open, student]);

  // D30: the student number is NOT required to create — omitting it is how the server is
  // asked to issue the next YYYYMM### (§D9).
  const namesMissing = firstName.trim().length === 0 || lastName.trim().length === 0;

  /**
   * Section A · Personal information is now REQUIRED IN FULL (D39), on create AND on
   * edit. It gates edit too on purpose: a record already on file with gaps is exactly
   * the record the college needs completed, and letting an edit save around the gap
   * would mean the rule only ever applied to students admitted after today.
   *
   * MIDDLE NAME is the one deliberate exception — plenty of people genuinely have none,
   * so requiring it would only teach Registrars to type a placeholder.
   *
   * The server is unchanged and still accepts these as nullable. That is intentional:
   * this is a data-entry policy for the two human-facing forms, not a constraint that
   * should retroactively invalidate rows the college imported or the API's own callers.
   */
  const personalInfoMissing =
    namesMissing ||
    dateOfBirth.trim().length === 0 ||
    ssno.trim().length === 0 ||
    gender.trim().length === 0 ||
    civilStatus.trim().length === 0 ||
    religion.trim().length === 0;

  const submitDisabled = editing
    ? personalInfoMissing
    : personalInfoMissing || enrollmentDate.trim().length === 0;

  /** `""` → `null`, so clearing a field stores NULL rather than an empty string. */
  const orNull = (v: string) => v.trim() || null;

  const handleSubmit = () => {
    const csec = numCsec.trim() === '' ? null : Number(numCsec);
    onSubmit({
      // Omitted entirely when blank on create, so the server allocates (§D9).
      // On edit the field is disabled, so this is always the unchanged value.
      student_number: studentNumber.trim() || undefined,
      first_name: firstName.trim(),
      middle_name: orNull(middleName),
      last_name: lastName.trim(),
      date_of_birth: dateOfBirth.trim(),
      gender,
      enrollment_date: enrollmentDate.trim(),
      year_of_study: (yearOfStudy || null) as YearOfStudy | null,
      // ── the rest of the application form (D33) ──
      ssno: orNull(ssno),
      civil_status: orNull(civilStatus),
      religion: orNull(religion),
      street: orNull(street),
      city_town_village: orNull(cityTownVillage),
      district: district || null,
      address: address.trim(),
      phone: phone.trim(),
      mother_name: orNull(motherName),
      father_name: orNull(fatherName),
      nok_name: orNull(nokName),
      nok_relationship: orNull(nokRelationship),
      nok_phone: orNull(nokPhone),
      guardian_name: guardianName.trim(),
      guardian_phone: guardianPhone.trim(),
      guardian_email: guardianEmail.trim(),
      has_health_condition: hasHealthCondition,
      // Cleared with the tick-box, so an un-ticked record cannot keep a stale note.
      health_condition_note: hasHealthCondition ? orNull(healthConditionNote) : null,
      atlib_exam: atlibExam,
      num_csec: csec != null && Number.isFinite(csec) ? csec : null,
      finance_name: orNull(financeName),
      finance_phone: orNull(financePhone),
      finance_email: orNull(financeEmail),
      enrollment_load: enrollmentLoad || null,
      // ── D34 · the client's columns ──
      email: orNull(email),
      student_id_original: studentIdOriginal.trim() === '' ? null : Number(studentIdOriginal),
      transferred_from: orNull(transferredFrom),
      graduation_date: orNull(graduationDate),
      // Only re-sent when the DATE half changed, so a stamped time survives an edit that
      // did not touch this field (see the note in the reset effect).
      dropout_date:
        dropoutDate === (student?.dropout_date ?? '').slice(0, 10)
          ? student?.dropout_date ?? null
          : orNull(dropoutDate),
      dropout_reason: orNull(dropoutReason),
      comments: orNull(comments),
      origin: orNull(origin),
      // Both create-only — the API rejects them on PATCH. See the component note.
      program_id: editing ? undefined : programId || null,
      offering_ids: editing ? undefined : offeringIds,
    });
  };

  const err = (field: string) => fieldErrors?.[field]?.join(' ');

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit student' : 'Add student'}
      submitLabel={editing ? 'Save changes' : 'Create student'}
      submitting={submitting}
      submitDisabled={submitDisabled}
      error={error}
      maxWidth="md"
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          The same information the BAJC application collects. Every field under{' '}
          <strong>Personal information</strong> is required, along with the enrollment
          date; middle name is the one exception. Leave anything else the form does not
          mark required blank.
        </Typography>

        {/* ═══ Section A · Personal information ═══════════════════════════════ */}
        <SectionBand>Personal information</SectionBand>

        <TextField
          label="Student ID"
          value={studentNumber}
          onChange={(e) => setStudentNumber(e.target.value)}
          fullWidth
          disabled={editing}
          error={Boolean(fieldErrors?.student_number)}
          helperText={
            err('student_number') ??
            (editing
              ? 'The student ID cannot be changed here.'
              : 'Leave blank and one is issued automatically (YYYYMM###). Fill it in only to import a student who already has an ID.')
          }
        />

        {/* D30 §D10 — names are stored and sorted in parts, so they are entered in
            parts. Surname first: it is the field the register is ordered on. */}
        <Row>
          <TextField
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            fullWidth
            autoFocus={!editing}
            error={Boolean(fieldErrors?.last_name)}
            helperText={err('last_name')}
          />
          <TextField
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            fullWidth
            error={Boolean(fieldErrors?.first_name)}
            helperText={err('first_name')}
          />
          <TextField
            label="Middle name"
            value={middleName}
            onChange={(e) => setMiddleName(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.middle_name)}
            helperText={err('middle_name') ?? 'Optional — the only one in this section.'}
          />
        </Row>

        <Row>
          <DateField
            label="Date of birth"
            value={dateOfBirth}
            onChange={setDateOfBirth}
            required
            fullWidth
            error={Boolean(fieldErrors?.date_of_birth)}
            helperText={err('date_of_birth')}
          />
          <TextField
            label="Social Security no."
            value={ssno}
            onChange={(e) => setSsno(e.target.value)}
            required
            fullWidth
            inputProps={{ maxLength: 9 }}
            error={Boolean(fieldErrors?.ssno)}
            helperText={err('ssno')}
          />
          <TextField
            select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            required
            fullWidth
            error={Boolean(fieldErrors?.gender)}
            helperText={err('gender')}
          >
            {GENDERS.map((option) => (
              <MenuItem key={option} value={option}>
                {GENDER_LABEL[option]}
              </MenuItem>
            ))}
            {/* Only rendered for a value the pair above does not cover — see the state
                declaration. Without it the select would be blank and a save would wipe
                whatever was actually on file. */}
            {!(GENDERS as readonly string[]).includes(gender) && gender && (
              <MenuItem value={gender}>{gender} (as recorded)</MenuItem>
            )}
          </TextField>
        </Row>

        <Row>
          {/* D40 — a dropdown, replacing free text. The COLUMN stays `varchar(50)`, the
              same split D37 settled for gender: the write path is what gets constrained,
              so a student imported from the client's previous system keeps a status this
              list does not carry instead of being rejected on the next unrelated save.

              `civilStatusOptions` appends that stored value as an "(as recorded)" option.
              Without it the select opens BLANK on such a student and saving anything else
              on the form quietly erases their civil status. */}
          <TextField
            label="Civil status"
            select
            value={civilStatus}
            onChange={(e) => setCivilStatus(e.target.value)}
            required
            fullWidth
            error={Boolean(fieldErrors?.civil_status)}
            helperText={err('civil_status')}
          >
            {civilStatusChoices.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {/* D39 (Meeting #2 item 8) — a dropdown fed by the client-owned `religions`
              table, replacing free text. The COLUMN is still free text: D37 settled that
              the write path is what gets constrained, so a student imported from the
              client's previous system keeps a religion this list does not carry.

              `religionOptions` appends that stored value as an "(as recorded)" option.
              Without it the select would open BLANK on such a student, and saving an
              unrelated edit from a blank select would quietly erase their religion. */}
          <TextField
            label="Religion"
            select
            value={religion}
            onChange={(e) => setReligion(e.target.value)}
            required
            fullWidth
            error={Boolean(fieldErrors?.religion)}
            helperText={
              err('religion') ??
              (religions.isLoading
                ? 'Loading…'
                : religionChoices.length === 0
                  ? 'No religions configured yet — ask the Dean to add them.'
                  : 'The directory filter follows this.')
            }
          >
            {religionChoices.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {/* Read-only on edit: the LOGIN lives on the `users` row, not here. D34 renamed
              the field it reads — the student now has an `email` column of their own. */}
          {editing && (
            <TextField
              label="Login e-mail"
              value={student?.login_email ?? ''}
              fullWidth
              disabled
              helperText={
                student?.login_email
                  ? 'Changed in Settings → Users.'
                  : 'No account yet — issued from Settings → Users.'
              }
            />
          )}
        </Row>

        {/* ═══ Address ════════════════════════════════════════════════════════ */}
        <SectionBand>Address</SectionBand>
        <Row>
          <TextField
            label="Street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            fullWidth
          />
          <TextField
            label="Village / town / city"
            value={cityTownVillage}
            onChange={(e) => setCityTownVillage(e.target.value)}
            fullWidth
          />
          <TextField
            select
            label="District"
            value={district}
            onChange={(e) => setDistrict(e.target.value as District | '')}
            fullWidth
          >
            <MenuItem value="">—</MenuItem>
            {DISTRICTS.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </TextField>
        </Row>
        <TextField
          label="Mailing address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          fullWidth
          // A second, free-text address predating the split. Kept because report cards and
          // letters print it verbatim, and the three structured parts do not always
          // compose into what an envelope needs.
          helperText="Printed as-is on letters and report cards."
        />

        {/* ═══ Contact ════════════════════════════════════════════════════════ */}
        <SectionBand>Contact</SectionBand>
        <Row>
          <TextField
            label="Personal telephone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            fullWidth
          />
          {/* D34 — the student's OWN address, from the client's schema. Before this the
              student record had no email column at all and the profile showed the LOGIN,
              which is NULL for anyone registered on paper. */}
          <TextField
            label="Personal e-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.email)}
            helperText={
              err('email') ?? 'How the office writes to them. Separate from any login.'
            }
          />
        </Row>

        {/* ═══ Family and emergency contact ═══════════════════════════════════ */}
        <SectionBand>Family and emergency contact</SectionBand>
        <Row>
          <TextField
            label="Mother's name"
            value={motherName}
            onChange={(e) => setMotherName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Father's name"
            value={fatherName}
            onChange={(e) => setFatherName(e.target.value)}
            fullWidth
          />
        </Row>
        <Row>
          <TextField
            label="Next of kin"
            value={nokName}
            onChange={(e) => setNokName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Relationship"
            value={nokRelationship}
            onChange={(e) => setNokRelationship(e.target.value)}
            fullWidth
          />
          <TextField
            label="Telephone"
            value={nokPhone}
            onChange={(e) => setNokPhone(e.target.value)}
            fullWidth
          />
        </Row>
        <Row>
          <TextField
            label="Guardian name"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
            fullWidth
            // Separate from the parents and from next of kin: the guardian is who the
            // school corresponds with, which is not always either of them.
            helperText="Who the school contacts about this student."
          />
          <TextField
            label="Guardian phone"
            value={guardianPhone}
            onChange={(e) => setGuardianPhone(e.target.value)}
            fullWidth
          />
          <TextField
            label="Guardian email"
            type="email"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
            fullWidth
          />
        </Row>

        {/* ═══ Health ═════════════════════════════════════════════════════════ */}
        <SectionBand>Health</SectionBand>
        <FormControlLabel
          control={
            <Checkbox
              checked={hasHealthCondition}
              onChange={(e) => setHasHealthCondition(e.target.checked)}
            />
          }
          label="Has a health or learning condition"
        />
        {hasHealthCondition && (
          <TextField
            label="Condition (a medical certificate is attached on paper)"
            value={healthConditionNote}
            onChange={(e) => setHealthConditionNote(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
        )}

        {/* ═══ Section B · Examinations ═══════════════════════════════════════ */}
        <SectionBand>Examinations</SectionBand>
        <Row>
          <FormControlLabel
            control={
              <Checkbox checked={atlibExam} onChange={(e) => setAtlibExam(e.target.checked)} />
            }
            label="Sat the ATLIB exam"
          />
          <TextField
            label="Number of CSEC exams"
            type="number"
            value={numCsec}
            onChange={(e) => setNumCsec(e.target.value)}
            inputProps={{ min: 0, max: 20 }}
            error={Boolean(fieldErrors?.num_csec)}
            helperText={err('num_csec')}
            sx={{ minWidth: { sm: 220 } }}
          />
        </Row>

        {/* ═══ Section C · Financial information ══════════════════════════════ */}
        <SectionBand>Financial information</SectionBand>
        <Typography variant="body2" color="text.secondary">
          Who finances this study? Often not the student, and not necessarily a parent —
          the form asks separately for exactly that reason.
        </Typography>
        <Row>
          <TextField
            label="Name"
            value={financeName}
            onChange={(e) => setFinanceName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Telephone"
            value={financePhone}
            onChange={(e) => setFinancePhone(e.target.value)}
            fullWidth
          />
          <TextField
            label="E-mail"
            value={financeEmail}
            onChange={(e) => setFinanceEmail(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.finance_email)}
            helperText={err('finance_email')}
          />
        </Row>

        {/* ═══ Section E · Programme of study ═════════════════════════════════ */}
        <SectionBand>Programme of study</SectionBand>
        {editing ? (
          <TextField
            label="Programme"
            value={
              student?.program ? `${student.program.code} — ${student.program.name}` : 'Not assigned'
            }
            fullWidth
            disabled
            // Not an oversight: a programme change closes the open `student_program_history`
            // row and opens a new one in the same transaction (§D12). Writing the column
            // from here would leave the history behind, so it is the Dean's action.
            helperText="Changed by the Dean, under Academic history — a change is recorded in the student's programme history."
          />
        ) : (
          <TextField
            select
            label="Programme of study"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.program_id) || programsQuery.isError}
            // An empty picker used to look identical to "none chosen yet" on the wizard, so
            // say which of the three states this is instead.
            helperText={
              err('program_id') ??
              (programsQuery.isError
                ? 'Could not load the programmes. Retry, or check that the catalog is seeded.'
                : programsQuery.isLoading
                  ? 'Loading programmes…'
                  : programOptions.length === 0
                    ? 'No active programmes are available to choose from.'
                    : 'Recorded in the programme history from the enrollment date.')
            }
          >
            <MenuItem value="">—</MenuItem>
            {programOptions.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code} — {p.name}
              </MenuItem>
            ))}
          </TextField>
        )}

        <Row>
          <TextField
            select
            label="Year of study"
            value={yearOfStudy}
            onChange={(e) => setYearOfStudy(e.target.value)}
            fullWidth
            error={Boolean(fieldErrors?.year_of_study)}
            helperText={err('year_of_study') ?? "The student's own level."}
          >
            <MenuItem value="">Not set</MenuItem>
            {YEAR_OF_STUDY_OPTIONS.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Study load"
            value={enrollmentLoad}
            onChange={(e) => setEnrollmentLoad(e.target.value as EnrollmentLoad | '')}
            fullWidth
            // Year and load are SEPARATE questions on the form. `sims_bk.sql` had one
            // column conflating them, which could answer neither.
            helperText="Part Time is under 15 credits a session; Full Time is over 15."
          >
            <MenuItem value="">Not set</MenuItem>
            {ENROLLMENT_LOADS.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
          <DateField
            label="Enrollment date"
            value={enrollmentDate}
            onChange={setEnrollmentDate}
            required
            fullWidth
            error={Boolean(fieldErrors?.enrollment_date)}
            helperText={err('enrollment_date')}
          />
        </Row>

        {/* ═══ Registry ═══════════════════════════════════════════════════════ */}
        {/* D34 — the remaining columns from the client's schema. Grouped last and after
            the programme because none of them describes the person: they are the office's
            own record-keeping about the record. */}
        <SectionBand>Registry</SectionBand>
        <Row>
          <TextField
            label="Transferred from"
            value={transferredFrom}
            onChange={(e) => setTransferredFrom(e.target.value)}
            fullWidth
            helperText="The institution a transfer student came from."
          />
          <TextField
            label="Original student ID"
            value={studentIdOriginal}
            onChange={(e) => setStudentIdOriginal(e.target.value)}
            fullWidth
            inputProps={{ inputMode: 'numeric' }}
            error={Boolean(fieldErrors?.student_id_original)}
            helperText={
              err('student_id_original') ?? 'The ID they carried in a previous system.'
            }
          />
          <TextField
            label="Origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            fullWidth
            helperText="Where this record came from."
          />
        </Row>
        {/* Both dates are STAMPED AUTOMATICALLY when the status changes to `graduated` or
            `DropOut` (see `change_student_status`), so they are here to CORRECT rather
            than to set — which is why neither is offered on the create form's blank
            record and neither is required. */}
        {editing && (
          <Row>
            <DateField
              label="Graduation date"
              value={graduationDate}
              onChange={setGraduationDate}
              fullWidth
              helperText="Set automatically when the status becomes Graduated."
            />
            <DateField
              label="Drop-out date"
              value={dropoutDate}
              onChange={setDropoutDate}
              fullWidth
              helperText="Set automatically when the status becomes Drop out."
            />
            <TextField
              label="Drop-out reason"
              value={dropoutReason}
              onChange={(e) => setDropoutReason(e.target.value)}
              fullWidth
              error={Boolean(fieldErrors?.dropout_reason)}
              helperText={err('dropout_reason')}
            />
          </Row>
        )}
        <TextField
          label="Comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          helperText="Internal notes. Never shown to the student."
        />

        {!editing && (
          <Autocomplete
            multiple
            options={offeringOptions}
            value={offeringOptions.filter((o) => offeringIds.includes(o.id))}
            onChange={(_e, next) => setOfferingIds(next.map((o) => o.id))}
            getOptionLabel={(o) => (o.course_name ? `${o.label} — ${o.course_name}` : o.label)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={offeringsQuery.isLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label={`${strings.terms.courseOfferings} (optional)`}
                placeholder={
                  offeringIds.length === 0
                    ? 'Enrol now, or later from an offering roster'
                    : undefined
                }
                error={Boolean(fieldErrors?.offering_ids)}
                helperText={
                  err('offering_ids') ??
                  'Pick every course this student will take this session. You can change this later from an offering roster.'
                }
              />
            )}
          />
        )}
        {editing && (
          <Box>
            <Typography variant="body2" color="text.secondary">
              Course enrolment is changed from an offering&apos;s roster, not here — with
              many enrolments, &ldquo;set them from this form&rdquo; would be ambiguous
              about removals.
            </Typography>
          </Box>
        )}
      </Stack>
    </FormDialog>
  );
}

export default StudentFormDialog;

import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import { FormDialog } from '@shared/components';
import type { ProgramListItem, ProgramWritePayload } from '../types';

export interface ProgramFormDialogProps {
  open: boolean;
  /** Edit mode when provided (create otherwise). */
  program?: ProgramListItem | null;
  submitting: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string[]>;
  onSubmit: (values: ProgramWritePayload) => void;
  onClose: () => void;
}

/** The awards BAJC confers (plan §A1). Free text underneath, so a new award does not
 *  need a code change — these are just the ones that exist today. */
const AWARDS = [
  'Associate of Social Science',
  'Associate of Science',
  'Associate of Arts',
];

/**
 * Create / edit a PROGRAMME (D30 §D3). Dean-only — the screen never opens this for a
 * Registrar (`canWrite(role, 'programs')`), and the server re-checks.
 *
 * The pass-mark field is the one that repays explanation: **it is per programme**
 * (§D5). Primary Education passes at C (2.00) and every other BAJC programme at
 * C+ (2.50). It cannot live on the grading scale, whose pass mark is one number per
 * ACADEMIC YEAR — a year-level number cannot say two different things about two
 * programmes running inside it at once.
 */
export function ProgramFormDialog({
  open,
  program,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: ProgramFormDialogProps) {
  const editing = Boolean(program);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [award, setAward] = useState('');
  const [totalCredits, setTotalCredits] = useState('');
  const [passMark, setPassMark] = useState('2.50');
  // D44, from the client's `sims_10` dump.
  const [admissionReq, setAdmissionReq] = useState('');
  const [graduationReq, setGraduationReq] = useState('');
  const [comments, setComments] = useState('');
  // D45 §8 — Department Management, on the programme (client decision C4).
  const [headOfDept, setHeadOfDept] = useState('');
  const [officeInfo, setOfficeInfo] = useState('');

  useEffect(() => {
    if (open) {
      setCode(program?.code ?? '');
      setName(program?.name ?? '');
      setAward(program?.award ?? '');
      setTotalCredits(program?.total_credits != null ? String(program.total_credits) : '');
      setPassMark(program?.min_passing_grade_point ?? '2.50');
      setAdmissionReq(program?.admission_requirements ?? '');
      setGraduationReq(program?.graduation_requirements ?? '');
      setComments(program?.comments ?? '');
      setHeadOfDept(program?.head_of_department ?? '');
      setOfficeInfo(program?.office_information ?? '');
    }
  }, [open, program]);

  const creditsNumber = totalCredits.trim() === '' ? null : Number(totalCredits);
  const creditsValid =
    creditsNumber === null || (Number.isInteger(creditsNumber) && creditsNumber > 0);
  const passNumber = Number(passMark);
  const passValid = Number.isFinite(passNumber) && passNumber >= 0 && passNumber <= 4;

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit programme' : 'Add programme'}
      submitLabel={editing ? 'Save changes' : 'Create programme'}
      submitting={submitting}
      submitDisabled={
        code.trim().length === 0 || name.trim().length === 0 || !creditsValid || !passValid
      }
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          code: code.trim(),
          name: name.trim(),
          award: award.trim() || null,
          // D44 — `|| null` rather than omitting, so emptying a box CLEARS the field. The
          // server reads these three through `exclude_unset`, so a sent null is a clear
          // and an absent key is "leave alone"; sending them always makes this dialog's
          // behaviour "what you see is what is saved".
          admission_requirements: admissionReq.trim() || null,
          graduation_requirements: graduationReq.trim() || null,
          comments: comments.trim() || null,
          // D45 §8 — same `|| null` rule: emptying the box CLEARS the field.
          head_of_department: headOfDept.trim() || null,
          office_information: officeInfo.trim() || null,
          total_credits: creditsNumber,
          min_passing_grade_point: passNumber.toFixed(2),
        })
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            fullWidth
            autoFocus
            inputProps={{ maxLength: 10, 'aria-required': true }}
            error={Boolean(fieldErrors?.code)}
            helperText={fieldErrors?.code?.join(' ') ?? 'e.g. BMAD — printed on the report card.'}
          />
          <TextField
            label="Programme name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            inputProps={{ maxLength: 250, 'aria-required': true }}
            error={Boolean(fieldErrors?.name)}
            helperText={fieldErrors?.name?.join(' ')}
          />
        </Stack>
        <TextField
          select
          label="Award"
          value={award}
          onChange={(e) => setAward(e.target.value)}
          fullWidth
          helperText="Optional."
        >
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {AWARDS.map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        {/* D44 — prospectus prose, from the client's own columns. Deliberately free text
            and deliberately NOT enforced: `program_courses` and `course_prerequisites`
            already express the rules the system checks, and a second machine-readable
            copy of them here would be a second thing to keep true. */}
        <TextField
          label="Admission requirements"
          value={admissionReq}
          onChange={(e) => setAdmissionReq(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          // D45 §9 — the 100-character cap is GONE. The column was varchar(100) and is
          // now TEXT; keeping the input cap would have left the field unable to hold the
          // paragraph it is named for, with the truncation happening silently in the box.
          error={Boolean(fieldErrors?.admission_requirements)}
          helperText={
            fieldErrors?.admission_requirements?.join(' ') ??
            'What an applicant needs to get in. Printed, not enforced.'
          }
        />
        <TextField
          label="Graduation requirements"
          value={graduationReq}
          onChange={(e) => setGraduationReq(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          error={Boolean(fieldErrors?.graduation_requirements)}
          helperText={
            fieldErrors?.graduation_requirements?.join(' ') ??
            'What a student needs to finish. The credit total and pass mark below are what the system actually checks.'
          }
        />
        {/* D45 §8 (Department Management). The blueprint assumes a Departments table;
            BAJC has none and organises by PROGRAMME, so its two departmental fields land
            here — the client chose this over re-parenting every programme and course to a
            new table. */}
        <TextField
          label="Head of department"
          value={headOfDept}
          onChange={(e) => setHeadOfDept(e.target.value)}
          fullWidth
          inputProps={{ maxLength: 150 }}
          error={Boolean(fieldErrors?.head_of_department)}
          helperText={
            fieldErrors?.head_of_department?.join(' ') ??
            'Displayed on the programme. Who a head can SEE is set by appointing them in Settings, not by this box.'
          }
        />
        <TextField
          label="Office information"
          value={officeInfo}
          onChange={(e) => setOfficeInfo(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          error={Boolean(fieldErrors?.office_information)}
          helperText={
            fieldErrors?.office_information?.join(' ') ??
            'Location, hours and contact for the programme office.'
          }
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Total credits"
            type="number"
            value={totalCredits}
            onChange={(e) => setTotalCredits(e.target.value)}
            fullWidth
            inputProps={{ min: 1, max: 999 }}
            error={Boolean(fieldErrors?.total_credits) || !creditsValid}
            helperText={
              fieldErrors?.total_credits?.join(' ') ??
              'As printed on the course sequence (BAJC: 86–102).'
            }
          />
          <TextField
            label="Pass mark (grade point)"
            type="number"
            value={passMark}
            onChange={(e) => setPassMark(e.target.value)}
            fullWidth
            inputProps={{ min: 0, max: 4, step: 0.25 }}
            error={Boolean(fieldErrors?.min_passing_grade_point) || !passValid}
            helperText={
              fieldErrors?.min_passing_grade_point?.join(' ') ??
              '2.50 = C+ for most programmes; Primary Education is 2.00 = C.'
            }
          />
        </Stack>
        {/* D44 — last, because it is the least structured thing on the form and putting a
            free-text box above the numbers invites people to stop reading there. */}
        <TextField
          label="Notes"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          error={Boolean(fieldErrors?.comments)}
          helperText={
            fieldErrors?.comments?.join(' ') ??
            'Internal notes on the programme. Not shown to students.'
          }
        />
      </Stack>
    </FormDialog>
  );
}

export default ProgramFormDialog;

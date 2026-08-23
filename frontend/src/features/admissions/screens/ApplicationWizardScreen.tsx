import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, LoadingState, PageContainer, PageHeader } from '@shared/components';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { ROUTES } from '@shared/constants/routes';
import { useProgramsList } from '@features/programs/hooks/usePrograms';
import {
  useApplication,
  useCreateApplication,
  useReplaceDocuments,
  useReplaceEducation,
  useSubmitApplication,
  useUpdateApplication,
} from '../hooks/useAdmissions';
import {
  DISTRICTS,
  DOCUMENT_TYPES,
  type ApplicationDetail,
  type ApplicationWritePayload,
  type District,
  type DocumentRow,
  type EducationLevel,
  type EducationRow,
  type EnrollmentLoad,
  type YearOfStudy,
} from '../types';

/**
 * The BAJC application form as a SEVEN-STEP WIZARD — one step per Section A–G (§D11).
 *
 * **Each step saves before it advances**, which is what makes the wizard
 * interruption-safe. Step A files a `draft` from the applicant's names alone (the only
 * fields the server requires to create one); every later step PATCHes that draft. A closed
 * tab, a dead battery or a phone call loses at most the step in progress, and the
 * half-finished application is waiting in the Drafts filter.
 *
 * Two consequences of that design are deliberate:
 *
 * * **The URL changes after step A.** `/applications/new` becomes
 *   `/applications/{id}/edit` via `replace`, so Back does not return to an empty form that
 *   would file a SECOND draft.
 * * **Sections B and F are their own endpoints**, not fields on the PATCH — they are
 *   repeating tables and the server replaces them as whole sets. Their steps save through
 *   `PUT .../education` and `PUT .../documents`.
 *
 * The server owns the completeness rules and reports them as `blocking_issues`; this screen
 * renders them verbatim rather than re-implementing the conditions (the under-18 guardian
 * rule especially). Duplicating them in the browser is how the two start disagreeing.
 */
const STEPS = [
  { key: 'A', label: 'Personal', full: 'Section A · Personal information' },
  { key: 'B', label: 'Education', full: 'Section B · Educational background' },
  { key: 'C', label: 'Financial', full: 'Section C · Financial information' },
  { key: 'D', label: 'Recommendation', full: 'Section D · Recommendation' },
  { key: 'E', label: 'Programme', full: 'Section E · Programme of study' },
  { key: 'F', label: 'Documents', full: 'Section F · Documents to submit' },
  { key: 'G', label: 'Agreement', full: 'Section G · Agreement' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

/** Local editing shape — every field a string, so a partially-typed form is representable. */
interface Draft {
  first_name: string;
  middle_name: string;
  last_name: string;
  school_year: string;
  date_of_birth: string;
  ssno: string;
  gender: string;
  civil_status: string;
  religion: string;
  phone: string;
  email: string;
  has_health_condition: boolean;
  health_condition_note: string;
  street: string;
  city_town_village: string;
  district: District | '';
  mother_name: string;
  father_name: string;
  nok_name: string;
  nok_relationship: string;
  nok_phone: string;
  atlib_exam: boolean;
  num_csec: string;
  finance_name: string;
  finance_phone: string;
  finance_email: string;
  recommendation_received: boolean;
  program_id: string;
  year_of_study: YearOfStudy | '';
  enrollment_load: EnrollmentLoad | '';
  applicant_signed_at: string;
  guardian_signed_at: string;
}

const EMPTY: Draft = {
  first_name: '',
  middle_name: '',
  last_name: '',
  school_year: '',
  date_of_birth: '',
  ssno: '',
  gender: '',
  civil_status: '',
  religion: '',
  phone: '',
  email: '',
  has_health_condition: false,
  health_condition_note: '',
  street: '',
  city_town_village: '',
  district: '',
  mother_name: '',
  father_name: '',
  nok_name: '',
  nok_relationship: '',
  nok_phone: '',
  atlib_exam: false,
  num_csec: '',
  finance_name: '',
  finance_phone: '',
  finance_email: '',
  recommendation_received: false,
  program_id: '',
  year_of_study: '',
  enrollment_load: '',
  applicant_signed_at: '',
  guardian_signed_at: '',
};

function fromDetail(detail: ApplicationDetail): Draft {
  return {
    first_name: detail.first_name ?? '',
    middle_name: detail.middle_name ?? '',
    last_name: detail.last_name ?? '',
    school_year: detail.school_year ?? '',
    date_of_birth: detail.date_of_birth ?? '',
    ssno: detail.ssno ?? '',
    gender: detail.gender ?? '',
    civil_status: detail.civil_status ?? '',
    religion: detail.religion ?? '',
    phone: detail.phone ?? '',
    email: detail.email ?? '',
    has_health_condition: detail.has_health_condition,
    health_condition_note: detail.health_condition_note ?? '',
    street: detail.street ?? '',
    city_town_village: detail.city_town_village ?? '',
    district: detail.district ?? '',
    mother_name: detail.mother_name ?? '',
    father_name: detail.father_name ?? '',
    nok_name: detail.nok_name ?? '',
    nok_relationship: detail.nok_relationship ?? '',
    nok_phone: detail.nok_phone ?? '',
    atlib_exam: detail.atlib_exam,
    num_csec: detail.num_csec == null ? '' : String(detail.num_csec),
    finance_name: detail.finance_name ?? '',
    finance_phone: detail.finance_phone ?? '',
    finance_email: detail.finance_email ?? '',
    recommendation_received: detail.recommendation_received,
    program_id: detail.program?.id ?? '',
    year_of_study: detail.year_of_study ?? '',
    enrollment_load: detail.enrollment_load ?? '',
    applicant_signed_at: detail.applicant_signed_at ?? '',
    guardian_signed_at: detail.guardian_signed_at ?? '',
  };
}

/** Empty string → null, so clearing a field CLEARS it rather than storing `""`. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** Only the fields the given step owns. Sending the whole draft every step would work,
 *  but a step that only asks about money should not be able to overwrite a name. */
function payloadForStep(stepKey: StepKey, draft: Draft): ApplicationWritePayload {
  switch (stepKey) {
    case 'A':
      return {
        first_name: draft.first_name.trim(),
        middle_name: orNull(draft.middle_name),
        last_name: draft.last_name.trim(),
        school_year: orNull(draft.school_year),
        date_of_birth: orNull(draft.date_of_birth),
        ssno: orNull(draft.ssno),
        gender: orNull(draft.gender),
        civil_status: orNull(draft.civil_status),
        religion: orNull(draft.religion),
        phone: orNull(draft.phone),
        email: orNull(draft.email),
        has_health_condition: draft.has_health_condition,
        health_condition_note: orNull(draft.health_condition_note),
        street: orNull(draft.street),
        city_town_village: orNull(draft.city_town_village),
        district: draft.district === '' ? null : draft.district,
        mother_name: orNull(draft.mother_name),
        father_name: orNull(draft.father_name),
        nok_name: orNull(draft.nok_name),
        nok_relationship: orNull(draft.nok_relationship),
        nok_phone: orNull(draft.nok_phone),
      };
    case 'B':
      // The institution rows go through their own endpoint; these two are the
      // single-valued examination questions that follow them on the form.
      return {
        atlib_exam: draft.atlib_exam,
        num_csec: draft.num_csec.trim() === '' ? null : Number(draft.num_csec),
      };
    case 'C':
      return {
        finance_name: orNull(draft.finance_name),
        finance_phone: orNull(draft.finance_phone),
        finance_email: orNull(draft.finance_email),
      };
    case 'D':
      return { recommendation_received: draft.recommendation_received };
    case 'E':
      return {
        program_id: draft.program_id === '' ? null : draft.program_id,
        year_of_study: draft.year_of_study === '' ? null : draft.year_of_study,
        enrollment_load: draft.enrollment_load === '' ? null : draft.enrollment_load,
      };
    case 'G':
      return {
        applicant_signed_at: orNull(draft.applicant_signed_at),
        guardian_signed_at: orNull(draft.guardian_signed_at),
      };
    default:
      return {};
  }
}

export function ApplicationWizardScreen() {
  const navigate = useNavigate();
  const { applicationId } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [hydrated, setHydrated] = useState(false);

  const detailQuery = useApplication(applicationId);
  const programsQuery = useProgramsList({ page: 1, page_size: 100 });
  const createMut = useCreateApplication();
  const updateMut = useUpdateApplication();
  const educationMut = useReplaceEducation();
  const documentsMut = useReplaceDocuments();
  const submitMut = useSubmitApplication();

  const detail = detailQuery.data;
  const programmeOptions = programsQuery.data?.items ?? [];
  // `STEPS[step]` is `Step | undefined` under `noUncheckedIndexedAccess`. `step` is only
  // ever moved with `Math.min`/`Math.max` inside the range, so narrow once here rather
  // than sprinkling `!` through the JSX.
  const current = STEPS[step] ?? STEPS[0];

  // Hydrate ONCE from the server record. Re-running on every `detail` change would
  // overwrite what the user is typing each time a save returns the merged application.
  useEffect(() => {
    if (!detail || hydrated) return;
    setDraft(fromDetail(detail));
    setEducation(detail.education);
    setDocuments(detail.documents);
    setHydrated(true);
  }, [detail, hydrated]);

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setDraft((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const saving =
    createMut.isPending ||
    updateMut.isPending ||
    educationMut.isPending ||
    documentsMut.isPending ||
    submitMut.isPending;

  const onError = (err: unknown) => {
    setError(apiErrorMessage(err));
    setFieldErrors(fieldErrorsFrom(err) ?? {});
  };

  /** Persist the CURRENT step. Returns the application id, or null if it failed. */
  const saveStep = useCallback(async (): Promise<string | null> => {
    setError(null);
    setFieldErrors({});
    const key = current.key;
    try {
      if (!applicationId) {
        // Step A on a brand-new form: file the draft. Names are all the server needs.
        const created = await createMut.mutateAsync({
          ...payloadForStep('A', draft),
          first_name: draft.first_name.trim(),
          last_name: draft.last_name.trim(),
        });
        // `replace`, so Back does not land on an empty /new that would file a SECOND draft.
        navigate(`${ROUTES.applications}/${created.id}/edit`, { replace: true });
        return created.id;
      }
      if (key === 'B') {
        await educationMut.mutateAsync({ id: applicationId, items: education });
      }
      if (key === 'F') {
        await documentsMut.mutateAsync({ id: applicationId, items: documents });
      }
      const body = payloadForStep(current.key, draft);
      if (Object.keys(body).length > 0) {
        await updateMut.mutateAsync({ id: applicationId, body });
      }
      return applicationId;
    } catch (err) {
      onError(err);
      return null;
    }
  }, [
    applicationId,
    createMut,
    current,
    documentsMut,
    documents,
    draft,
    education,
    educationMut,
    navigate,
    updateMut,
  ]);

  const next = async () => {
    if ((await saveStep()) === null) return;
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const back = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const finish = async () => {
    const id = await saveStep();
    if (id === null) return;
    navigate(`${ROUTES.applications}/${id}`);
  };

  const submitNow = async () => {
    const id = await saveStep();
    if (id === null) return;
    try {
      await submitMut.mutateAsync(id);
      navigate(`${ROUTES.applications}/${id}`);
    } catch (err) {
      onError(err);
    }
  };

  const canLeaveStepA = draft.first_name.trim().length > 0 && draft.last_name.trim().length > 0;
  const isLast = step === STEPS.length - 1;

  if (applicationId && detailQuery.isLoading) return <LoadingState variant="form" />;
  if (applicationId && detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (detail && detail.status !== 'draft') {
    // A submitted or decided application is reviewed, not re-typed. Sending them to the
    // review screen is more useful than a form that will 409 on the first save.
    return (
      <PageContainer>
        <ErrorState
          title="This application is no longer a draft"
          message={`It is ${detail.status}. Use Try again to open its review screen.`}
          onRetry={() => navigate(`${ROUTES.applications}/${detail.id}`)}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(ROUTES.applications)}
        sx={{ mb: 1, alignSelf: 'flex-start' }}
      >
        All applications
      </Button>

      <PageHeader
        title={applicationId ? 'Continue application' : 'New application'}
        subtitle="The BAJC application form, one section at a time. Each step is saved as you go."
      />

      <Stepper
        activeStep={step}
        alternativeLabel={!isMobile}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        sx={{ mb: 3 }}
      >
        {STEPS.map((s, index) => (
          <Step key={s.key} completed={index < step}>
            <StepLabel>{`${s.key} · ${s.label}`}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          <AlertTitle>Could not save this section</AlertTitle>
          {error}
          {fieldErrors.application && (
            <Box component="ul" sx={{ pl: 2.5, mb: 0, mt: 1 }}>
              {fieldErrors.application.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" component="h2" sx={{ mb: 2 }}>
          {current.full}
        </Typography>

        {current.key === 'A' && (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="First name"
                value={draft.first_name}
                onChange={(e) => set('first_name', e.target.value)}
                required
                fullWidth
                autoFocus
                error={Boolean(fieldErrors.first_name)}
              />
              <TextField
                label="Middle name"
                value={draft.middle_name}
                onChange={(e) => set('middle_name', e.target.value)}
                fullWidth
              />
              <TextField
                label="Last name"
                value={draft.last_name}
                onChange={(e) => set('last_name', e.target.value)}
                required
                fullWidth
                error={Boolean(fieldErrors.last_name)}
                helperText={
                  canLeaveStepA ? undefined : 'The names are all that is needed to save a draft.'
                }
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="School year"
                value={draft.school_year}
                onChange={(e) => set('school_year', e.target.value)}
                placeholder="2026-2027"
                fullWidth
              />
              <TextField
                label="Date of birth"
                type="date"
                value={draft.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Social Security no."
                value={draft.ssno}
                onChange={(e) => set('ssno', e.target.value)}
                fullWidth
                inputProps={{ maxLength: 9 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Gender"
                value={draft.gender}
                onChange={(e) => set('gender', e.target.value)}
                fullWidth
              />
              <TextField
                label="Civil status"
                value={draft.civil_status}
                onChange={(e) => set('civil_status', e.target.value)}
                fullWidth
              />
              <TextField
                label="Religion"
                value={draft.religion}
                onChange={(e) => set('religion', e.target.value)}
                fullWidth
              />
            </Stack>

            <Divider textAlign="left">
              <Typography variant="overline">Address</Typography>
            </Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Street"
                value={draft.street}
                onChange={(e) => set('street', e.target.value)}
                fullWidth
              />
              <TextField
                label="Village / town / city"
                value={draft.city_town_village}
                onChange={(e) => set('city_town_village', e.target.value)}
                fullWidth
              />
              <TextField
                select
                label="District"
                value={draft.district}
                onChange={(e) => set('district', e.target.value as District)}
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {DISTRICTS.map((district) => (
                  <MenuItem key={district} value={district}>
                    {district}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Divider textAlign="left">
              <Typography variant="overline">Contact</Typography>
            </Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Personal telephone"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                fullWidth
              />
              <TextField
                label="Personal e-mail"
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
                fullWidth
                helperText="Becomes the student's login when the application is accepted."
              />
            </Stack>

            <Divider textAlign="left">
              <Typography variant="overline">Family and emergency contact</Typography>
            </Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Mother's name"
                value={draft.mother_name}
                onChange={(e) => set('mother_name', e.target.value)}
                fullWidth
              />
              <TextField
                label="Father's name"
                value={draft.father_name}
                onChange={(e) => set('father_name', e.target.value)}
                fullWidth
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Next of kin"
                value={draft.nok_name}
                onChange={(e) => set('nok_name', e.target.value)}
                fullWidth
              />
              <TextField
                label="Relationship"
                value={draft.nok_relationship}
                onChange={(e) => set('nok_relationship', e.target.value)}
                fullWidth
              />
              <TextField
                label="Telephone"
                value={draft.nok_phone}
                onChange={(e) => set('nok_phone', e.target.value)}
                fullWidth
              />
            </Stack>

            <Divider textAlign="left">
              <Typography variant="overline">Health</Typography>
            </Divider>
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.has_health_condition}
                  onChange={(e) => set('has_health_condition', e.target.checked)}
                />
              }
              label="Has a health or learning condition"
            />
            {draft.has_health_condition && (
              <TextField
                label="Condition (attach a medical certificate)"
                value={draft.health_condition_note}
                onChange={(e) => set('health_condition_note', e.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
            )}
          </Stack>
        )}

        {current.key === 'B' && (
          <Stack spacing={2}>
            <Alert severity="info">
              Credit transfer requires a CTA, the original transcript and course outlines, and
              may only be applied for at admission. A <strong>tertiary</strong> institution
              must be listed here before the Dean can approve one.
            </Alert>

            <Stack spacing={1.5}>
              {education.map((row, index) => (
                <Card key={row.id ?? `new-${index}`} variant="outlined">
                  <CardContent>
                    <Stack spacing={2}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          label="Name of institution"
                          value={row.institution}
                          onChange={(e) =>
                            setEducation((prev) =>
                              prev.map((r, i) =>
                                i === index ? { ...r, institution: e.target.value } : r,
                              ),
                            )
                          }
                          required
                          fullWidth
                        />
                        <TextField
                          select
                          label="Education level"
                          value={row.education_level}
                          onChange={(e) =>
                            setEducation((prev) =>
                              prev.map((r, i) =>
                                i === index
                                  ? { ...r, education_level: e.target.value as EducationLevel }
                                  : r,
                              ),
                            )
                          }
                          sx={{ minWidth: 180 }}
                        >
                          <MenuItem value="High School">High School</MenuItem>
                          <MenuItem value="Tertiary">Tertiary</MenuItem>
                        </TextField>
                      </Stack>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ alignItems: { sm: 'center' } }}
                      >
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={row.graduated}
                              onChange={(e) =>
                                setEducation((prev) =>
                                  prev.map((r, i) =>
                                    i === index ? { ...r, graduated: e.target.checked } : r,
                                  ),
                                )
                              }
                            />
                          }
                          label="Graduated"
                        />
                        <TextField
                          label="Graduation date"
                          type="date"
                          value={row.graduation_date ?? ''}
                          onChange={(e) =>
                            setEducation((prev) =>
                              prev.map((r, i) =>
                                i === index
                                  ? { ...r, graduation_date: e.target.value || null }
                                  : r,
                              ),
                            )
                          }
                          InputLabelProps={{ shrink: true }}
                          required={row.graduated}
                          helperText={
                            row.graduated && !row.graduation_date
                              ? 'Required when graduated.'
                              : undefined
                          }
                          error={row.graduated && !row.graduation_date}
                          sx={{ minWidth: 200 }}
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title="Remove institution">
                          <IconButton
                            color="error"
                            onClick={() =>
                              setEducation((prev) => prev.filter((_, i) => i !== index))
                            }
                            aria-label={`Remove ${row.institution || 'institution'}`}
                          >
                            <DeleteOutlineIcon />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>

            <Button
              startIcon={<AddIcon />}
              onClick={() =>
                setEducation((prev) => [
                  ...prev,
                  {
                    institution: '',
                    education_level: 'High School',
                    graduated: false,
                    graduation_date: null,
                    sort_order: prev.length + 1,
                  },
                ])
              }
              sx={{ alignSelf: 'flex-start' }}
            >
              Add institution
            </Button>

            <Divider textAlign="left">
              <Typography variant="overline">Examinations</Typography>
            </Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={draft.atlib_exam}
                    onChange={(e) => set('atlib_exam', e.target.checked)}
                  />
                }
                label="Sat the ATLIB exam"
              />
              <TextField
                label="Number of CSEC exams"
                type="number"
                value={draft.num_csec}
                onChange={(e) => set('num_csec', e.target.value)}
                inputProps={{ min: 0, max: 20 }}
                sx={{ minWidth: 220 }}
              />
            </Stack>
          </Stack>
        )}

        {current.key === 'C' && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Who will finance this study? Often not the applicant, and not necessarily a
              parent — the form asks separately for exactly that reason.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Name"
                value={draft.finance_name}
                onChange={(e) => set('finance_name', e.target.value)}
                fullWidth
              />
              <TextField
                label="Telephone"
                value={draft.finance_phone}
                onChange={(e) => set('finance_phone', e.target.value)}
                fullWidth
              />
              <TextField
                label="E-mail"
                value={draft.finance_email}
                onChange={(e) => set('finance_email', e.target.value)}
                fullWidth
              />
            </Stack>
          </Stack>
        )}

        {current.key === 'D' && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              The BAJC Character and Academic Recommendation Form is completed by a high-school
              teacher. Tick this once it has arrived; the paper itself is tracked on the
              Section F checklist.
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.recommendation_received}
                  onChange={(e) => set('recommendation_received', e.target.checked)}
                />
              }
              label="Recommendation form received"
            />
          </Stack>
        )}

        {current.key === 'E' && (
          <Stack spacing={2}>
            <TextField
              select
              label="Programme of study"
              value={draft.program_id}
              onChange={(e) => set('program_id', e.target.value)}
              fullWidth
              required
              error={Boolean(fieldErrors.program_id) || programsQuery.isError}
              // An empty picker used to look identical to "no programmes chosen yet", so a
              // GET /programs that answered 200-with-no-rows was invisible on this screen.
              // Say which of the three states it is instead.
              helperText={
                fieldErrors.program_id?.join(' ') ??
                (programsQuery.isError
                  ? 'Could not load the programmes. Retry, or check that the catalog is seeded.'
                  : programsQuery.isLoading
                    ? 'Loading programmes…'
                    : programmeOptions.length === 0
                      ? 'No active programmes are available to choose from.'
                      : undefined)
              }
            >
              <MenuItem value="">—</MenuItem>
              {programmeOptions.map((program) => (
                <MenuItem key={program.id} value={program.id}>
                  {program.code} — {program.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Year of study"
                value={draft.year_of_study}
                onChange={(e) => set('year_of_study', e.target.value as YearOfStudy)}
                fullWidth
                required
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="First">First</MenuItem>
                <MenuItem value="Second">Second</MenuItem>
              </TextField>
              <TextField
                select
                label="Study load"
                value={draft.enrollment_load}
                onChange={(e) => set('enrollment_load', e.target.value as EnrollmentLoad)}
                fullWidth
                required
                // Year and load are SEPARATE questions on the form. `sims_bk.sql` had one
                // column conflating them, which could answer neither.
                helperText="Part Time is under 15 credits a term; Full Time is over 15."
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="Part Time">Part Time (&lt;15 credits)</MenuItem>
                <MenuItem value="Full Time">Full Time (&gt;15 credits)</MenuItem>
                <MenuItem value="Transient">Transient</MenuItem>
              </TextField>
            </Stack>
          </Stack>
        )}

        {current.key === 'F' && (
          <Stack spacing={2}>
            <Alert severity="info">
              A checklist, not an upload. Tick what has been received; the file itself is held
              on paper for now.
            </Alert>
            <Stack spacing={0.5}>
              {DOCUMENT_TYPES.map((type) => {
                const existing = documents.find((d) => d.document_type === type.value);
                return (
                  <FormControlLabel
                    key={type.value}
                    control={
                      <Checkbox
                        checked={existing?.received ?? false}
                        onChange={(e) =>
                          setDocuments((prev) => {
                            const found = prev.find((d) => d.document_type === type.value);
                            if (found) {
                              return prev.map((d) =>
                                d.document_type === type.value
                                  ? { ...d, received: e.target.checked }
                                  : d,
                              );
                            }
                            return [
                              ...prev,
                              {
                                document_type: type.value,
                                file_name: null,
                                content_type: null,
                                size_bytes: null,
                                received: e.target.checked,
                              },
                            ];
                          })
                        }
                      />
                    }
                    label={type.label}
                  />
                );
              })}
            </Stack>
          </Stack>
        )}

        {current.key === 'G' && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              A parent or guardian must also sign when the applicant is under 18 — the server
              checks that against the date of birth and refuses the submission if it is missing.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Applicant signed"
                type="date"
                value={draft.applicant_signed_at}
                onChange={(e) => set('applicant_signed_at', e.target.value)}
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Parent / guardian signed"
                type="date"
                value={draft.guardian_signed_at}
                onChange={(e) => set('guardian_signed_at', e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
                helperText="Required only if the applicant is under 18."
              />
            </Stack>

            {detail && detail.blocking_issues.length > 0 && (
              <Alert severity="warning">
                <AlertTitle>Still needed before this can be submitted</AlertTitle>
                <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
                  {detail.blocking_issues
                    .filter((issue) => !issue.startsWith('The application must be submitted'))
                    .map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                </Box>
              </Alert>
            )}
          </Stack>
        )}
      </Paper>

      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
        <Button onClick={back} disabled={step === 0 || saving}>
          Back
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {saving && <CircularProgress size={18} />}
        {applicationId && (
          <Button onClick={() => void finish()} disabled={saving}>
            Save and close
          </Button>
        )}
        {isLast ? (
          <Button variant="contained" onClick={() => void submitNow()} disabled={saving}>
            Save and submit
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void next()}
            disabled={saving || (step === 0 && !canLeaveStepA)}
          >
            Save and continue
          </Button>
        )}
      </Stack>
    </PageContainer>
  );
}

export default ApplicationWizardScreen;

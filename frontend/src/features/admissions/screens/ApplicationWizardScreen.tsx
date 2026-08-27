import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useAcademicYears } from '@features/settings/hooks/useSettings';
import { useReligions, religionOptions } from '@features/settings/hooks/useReligions';
import { GENDERS, GENDER_LABEL } from '@shared/types/enums';
import { schoolYearOptions } from '@shared/utils/schoolYears';
import {
  useApplication,
  useCreatePendingApplication,
  usePendingApplication,
  useReplaceDocuments,
  useReplaceEducation,
  useSubmitApplication,
  useSubmitPendingApplication,
  useUpdateApplication,
  useUpdatePendingApplication,
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
  type PendingApplicationDetail,
  type YearOfStudy,
} from '../types';

/**
 * The BAJC application form as a SEVEN-STEP WIZARD — one step per Section A–G (§D11).
 *
 * **D38 REVERSED THE SAVE MODEL.** Nothing is written until the Registrar asks for it.
 * *Continue* moves between sections in browser state and makes no request at all; the form
 * reaches the database only on the last step, through *Save and close* or *Save and submit*.
 *
 * Until D38 every step PATCHed `applications`, so a half-typed form was already an
 * admissions record — it appeared in the directory, it was counted, and the Dean could
 * read it. The client asked for the opposite, which changes three things here:
 *
 * * **The URL no longer changes mid-flow.** Step A used to file a draft and `replace` the
 *   URL so Back could not file a second one. With no save before the end there is nothing
 *   to guard against, and `/applications/new` stays put.
 * * **Sections B and F travel in the same body as the rest.** They are their own endpoints
 *   on a real application (`PUT .../education`, `PUT .../documents`) because the server
 *   replaces them as whole sets against an application id — which a form that has never
 *   been saved has not got. On the pending path they ride as arrays.
 * * **`blocking_issues` is only as fresh as the last save.** It comes back with the saved
 *   record, so mid-wizard it reflects what is on disk, not what is on screen. Section G
 *   says so rather than implying otherwise.
 *
 * **Three modes, one component**, chosen by the route:
 *
 *     /applications/new                    nothing on disk  -> POST /pending-applications
 *     /applications/pending/:pendingId/edit a pending form  -> PATCH /pending-applications
 *     /applications/:applicationId/edit     a REAL draft    -> PATCH /applications (+ the
 *                                                              two child endpoints)
 *
 * The third exists for `applications.draft` rows filed before D38. They are still editable,
 * under the same save-at-the-end rules as everything else, rather than being stranded.
 *
 * The server owns the completeness rules and reports them as `blocking_issues`; this screen
 * renders them verbatim rather than re-implementing the conditions (the under-18 guardian
 * rule especially). Duplicating them in the browser is how the two start disagreeing.
 */
/**
 * Shown on every control Section A now gates (D39). One constant rather than three
 * literals: the footer says the same thing in three places, and a rule the Registrar
 * meets as three different sentences reads as three different rules.
 */
const PERSONAL_INFO_HINT =
  'Section A · Personal information must be complete: first and last name, date of birth, ' +
  'Social Security no., gender, civil status and religion. Middle name is optional.';

const STEPS = [
  { key: 'A', label: 'Personal', full: 'Section A · Personal information' },
  { key: 'B', label: 'Education', full: 'Section B · Educational background' },
  { key: 'C', label: 'Financial', full: 'Section C · Financial information' },
  { key: 'D', label: 'Recommendation', full: 'Section D · Recommendation' },
  { key: 'E', label: 'Programme', full: 'Section E · Programme of study' },
  { key: 'F', label: 'Documents', full: 'Section F · Documents to submit' },
  { key: 'G', label: 'Agreement', full: 'Section G · Agreement' },
] as const;

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

/**
 * Server record → editing shape. Takes EITHER source: the two records carry the same
 * Sections A–G, and the fields that differ (`student_code`, `pending_credit_transfers`,
 * `created_by_name`) are none of them ones the form edits.
 */
function fromDetail(detail: ApplicationDetail | PendingApplicationDetail): Draft {
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

/**
 * The WHOLE form, every section at once.
 *
 * D38 replaced a per-step `payloadForStep`, which existed so that a step asking only about
 * money could not overwrite a name. That protection is no longer needed, and sending the
 * whole form is no longer wasteful: there is exactly one save, and the browser is holding
 * the only copy of every section — so a partial body would be the thing that lost data,
 * not the thing that prevented losing it.
 */
function wholeFormPayload(draft: Draft): ApplicationWritePayload {
  return {
    // Section A
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
    // Section B — the examinations half; the institution rows travel separately
    atlib_exam: draft.atlib_exam,
    num_csec: draft.num_csec.trim() === '' ? null : Number(draft.num_csec),
    // Section C
    finance_name: orNull(draft.finance_name),
    finance_phone: orNull(draft.finance_phone),
    finance_email: orNull(draft.finance_email),
    // Section D
    recommendation_received: draft.recommendation_received,
    // Section E
    program_id: draft.program_id === '' ? null : draft.program_id,
    year_of_study: draft.year_of_study === '' ? null : draft.year_of_study,
    enrollment_load: draft.enrollment_load === '' ? null : draft.enrollment_load,
    // Section G
    applicant_signed_at: orNull(draft.applicant_signed_at),
    guardian_signed_at: orNull(draft.guardian_signed_at),
  };
}

export function ApplicationWizardScreen() {
  const navigate = useNavigate();
  // Exactly one of these is set, or neither on `/applications/new`. See the module note.
  const { applicationId, pendingId } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [hydrated, setHydrated] = useState(false);
  /**
   * The pending row THIS session created, on a form that started at `/applications/new`.
   *
   * Without it, *Save and submit* on a brand-new form that the server then refuses as
   * incomplete would file a SECOND pending row on the next attempt: the save succeeds, the
   * submit 422s, the user fixes the missing field and presses the button again — and
   * `pendingId` is still undefined, so it POSTs afresh. One duplicate per failed attempt,
   * every one of them a real row in the Registrar's list.
   *
   * State rather than a URL rewrite because D38 deliberately stopped moving the URL
   * mid-flow; this is remembered for the life of the screen and no longer.
   */
  const [savedPendingId, setSavedPendingId] = useState<string | null>(null);

  const detailQuery = useApplication(applicationId);
  const pendingQuery = usePendingApplication(pendingId);
  const programsQuery = useProgramsList({ page: 1, page_size: 100 });
  // D37 — the School year dropdown is built from the years on file. Read-only use, so a
  // Registrar who cannot manage settings still gets the list.
  const academicYearsQuery = useAcademicYears();
  const updateMut = useUpdateApplication();
  const educationMut = useReplaceEducation();
  // D39 — the Religion vocabulary; see `useReligions` for why the column stays free text.
  const religions = useReligions();
  const religionChoices = useMemo(
    () => religionOptions(religions.data?.items, draft.religion),
    [religions.data, draft.religion],
  );
  const documentsMut = useReplaceDocuments();
  const submitMut = useSubmitApplication();
  const createPendingMut = useCreatePendingApplication();
  const updatePendingMut = useUpdatePendingApplication();
  const submitPendingMut = useSubmitPendingApplication();

  const detail = detailQuery.data;
  const pending = pendingQuery.data;
  const programmeOptions = programsQuery.data?.items ?? [];

  // ── D37: the two new dropdowns ──────────────────────────────────────────────
  const schoolYears = useMemo(
    () =>
      schoolYearOptions(
        (academicYearsQuery.data?.items ?? []).map((y) => y.name),
        draft.school_year,
      ),
    [academicYearsQuery.data, draft.school_year],
  );

  /**
   * Gender, split into "a value the dropdown offers" and "anything else".
   *
   * A `<select>` whose value is not among its options renders BLANK, and saving from a
   * blank select clears the field — so a legacy spelling has to be carried as its own
   * option rather than silently dropped. `'Male'` is exactly that case: it is on the one
   * live application today.
   */
  const genderRaw = draft.gender.trim();
  const genderCanonical = genderRaw.toLowerCase();
  const isKnownGender = (GENDERS as readonly string[]).includes(genderCanonical);
  const genderValue = isKnownGender ? genderCanonical : genderRaw;
  const legacyGender = !isKnownGender && genderRaw ? genderRaw : null;
  // `STEPS[step]` is `Step | undefined` under `noUncheckedIndexedAccess`. `step` is only
  // ever moved with `Math.min`/`Math.max` inside the range, so narrow once here rather
  // than sprinkling `!` through the JSX.
  const current = STEPS[step] ?? STEPS[0];

  // Hydrate ONCE from whichever record the route named. Re-running on every change would
  // overwrite what the user is typing each time a save returns the merged record.
  useEffect(() => {
    const source = detail ?? pending;
    if (!source || hydrated) return;
    setDraft(fromDetail(source));
    setEducation(source.education);
    setDocuments(source.documents);
    setHydrated(true);
  }, [detail, pending, hydrated]);

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setDraft((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const saving =
    updateMut.isPending ||
    educationMut.isPending ||
    documentsMut.isPending ||
    submitMut.isPending ||
    createPendingMut.isPending ||
    updatePendingMut.isPending ||
    submitPendingMut.isPending;

  const onError = (err: unknown) => {
    setError(apiErrorMessage(err));
    setFieldErrors(fieldErrorsFrom(err) ?? {});
  };

  /**
   * Persist the WHOLE form. Returns where it went, or `null` if it failed.
   *
   * The discriminated return is what lets the two callers stay honest about which submit
   * endpoint applies: a promoted pending form is submitted through
   * `/pending-applications/{id}/submit`, a real draft through `/applications/{id}/submit`,
   * and the two are not interchangeable — one of them also moves the row between tables.
   */
  const saveForm = useCallback(async (): Promise<
    { kind: 'application' | 'pending'; id: string } | null
  > => {
    setError(null);
    setFieldErrors({});
    try {
      if (applicationId) {
        // A `draft` row filed before D38. Still editable, under the same rules — the two
        // child endpoints are the only way to write its repeating tables.
        await updateMut.mutateAsync({ id: applicationId, body: wholeFormPayload(draft) });
        await educationMut.mutateAsync({ id: applicationId, items: education });
        await documentsMut.mutateAsync({ id: applicationId, items: documents });
        return { kind: 'application', id: applicationId };
      }

      const body = {
        ...wholeFormPayload(draft),
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        education,
        documents,
      };
      // Re-save the row this session already created, rather than filing another one.
      const target = pendingId ?? savedPendingId;
      const saved = target
        ? await updatePendingMut.mutateAsync({ id: target, body })
        : await createPendingMut.mutateAsync(body);
      setSavedPendingId(saved.id);
      return { kind: 'pending', id: saved.id };
    } catch (err) {
      onError(err);
      return null;
    }
  }, [
    applicationId,
    createPendingMut,
    documentsMut,
    documents,
    draft,
    education,
    educationMut,
    pendingId,
    savedPendingId,
    updateMut,
    updatePendingMut,
  ]);

  /**
   * D38 — *Continue* makes NO request. It moves between sections in browser state, which
   * is the whole point: nothing is written until the Registrar asks for it on the last step.
   */
  const next = () => {
    setError(null);
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const back = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 0));
  };

  /** *Save and close* — the form goes to the holding table and the Registrar leaves. */
  const finish = async () => {
    const saved = await saveForm();
    if (saved === null) return;
    navigate(
      saved.kind === 'application'
        ? `${ROUTES.applications}/${saved.id}`
        : `${ROUTES.applications}/pending`,
    );
  };

  /**
   * *Save and submit* — save, then submit through whichever endpoint matches.
   *
   * A 422 here leaves the saved form exactly where it is (the server does not consume a
   * pending row it refuses to promote), so the Registrar can fix what is missing and press
   * the button again. That is why the save is not rolled back on a failed submit.
   */
  const submitNow = async () => {
    const saved = await saveForm();
    if (saved === null) return;
    try {
      const application =
        saved.kind === 'application'
          ? await submitMut.mutateAsync(saved.id)
          : await submitPendingMut.mutateAsync(saved.id);
      navigate(`${ROUTES.applications}/${application.id}`);
    } catch (err) {
      onError(err);
    }
  };

  // The names are all the SAVE requires, so they are what gates leaving Section A — the
  // same rule as before D38, now enforced against the save rather than against a step.
  const hasNames = draft.first_name.trim().length > 0 && draft.last_name.trim().length > 0;

  /**
   * Section A — Personal information is REQUIRED IN FULL (D39), matching
   * `StudentFormDialog` — an application and a direct student record now demand the same
   * data, so acceptance can no longer produce a student the student form would refuse to
   * save. Middle name stays optional in both.
   *
   * This gates BOTH the step and the two save actions. D38 moved the write to the end of
   * the flow, so gating only Section A's Continue would leave a form that was completed
   * out of order savable with the gaps still in it.
   *
   * `school_year` is deliberately NOT here: it is the intake, not personal information,
   * and it already carries its own D37 vocabulary.
   */
  const personalInfoComplete =
    hasNames &&
    draft.date_of_birth.trim().length > 0 &&
    draft.ssno.trim().length > 0 &&
    draft.gender.trim().length > 0 &&
    draft.civil_status.trim().length > 0 &&
    draft.religion.trim().length > 0;
  const isLast = step === STEPS.length - 1;
  //: Whichever record the route named. Empty on a form that has never been saved.
  const savedIssues = (detail ?? pending)?.blocking_issues ?? [];

  if (applicationId && detailQuery.isLoading) return <LoadingState variant="form" />;
  if (applicationId && detailQuery.isError) {
    return <ErrorState onRetry={() => void detailQuery.refetch()} />;
  }
  if (pendingId && pendingQuery.isLoading) return <LoadingState variant="form" />;
  if (pendingId && pendingQuery.isError) {
    // A 404 here is usually the SCOPE, not a missing row: a pending form belongs to
    // whoever filed it, so another Registrar's id is indistinguishable from a dead one.
    return (
      <PageContainer>
        <ErrorState
          title="This pending form is not available"
          message="It may have been submitted, discarded, or filed by someone else."
          onRetry={() => navigate(`${ROUTES.applications}/pending`)}
        />
      </PageContainer>
    );
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
        title={applicationId || pendingId ? 'Continue application' : 'New application'}
        subtitle="The BAJC application form, one section at a time. Nothing is saved until you reach Section G."
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
                  hasNames ? undefined : 'The names are all that is needed to save the form.'
                }
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {/* D37 — a SELECT, not free text. `school_year` is a label distinct from
                  `academic_year_id`, and free text let the two diverge: the one live
                  application says 2026-2027 while the years on file are 2024-2025 and
                  2025-2026. The options are the years on file plus the next few derived
                  from the latest, because an application is for a FUTURE intake and a
                  strict list of existing years would block the normal case. */}
              <TextField
                select
                label="School year"
                value={draft.school_year}
                onChange={(e) => set('school_year', e.target.value)}
                fullWidth
                error={Boolean(fieldErrors.school_year)}
                helperText={
                  fieldErrors.school_year?.join(' ') ?? 'The intake this application is for.'
                }
              >
                <MenuItem value="">—</MenuItem>
                {schoolYears.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Date of birth"
                type="date"
                value={draft.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                required
                fullWidth
                InputLabelProps={{ shrink: true }}
                error={Boolean(fieldErrors.date_of_birth)}
                helperText={fieldErrors.date_of_birth?.join(' ')}
              />
              <TextField
                label="Social Security no."
                value={draft.ssno}
                onChange={(e) => set('ssno', e.target.value)}
                required
                fullWidth
                inputProps={{ maxLength: 9 }}
                error={Boolean(fieldErrors.ssno)}
                helperText={fieldErrors.ssno?.join(' ')}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {/* D37 — a SELECT, matching `StudentFormDialog`. Free text here is what
                  put 'Male' on this table beside 46 lowercase rows on
                  `student_profiles`, and acceptance copied it across verbatim. MariaDB's
                  collation hid it from the directory filter; the browser compares
                  case-sensitively and does not. */}
              <TextField
                select
                label="Gender"
                value={genderValue}
                onChange={(e) => set('gender', e.target.value)}
                required
                fullWidth
                error={Boolean(fieldErrors.gender)}
                helperText={fieldErrors.gender?.join(' ')}
              >
                {/* No blank row: the field is required, and an option that submits an
                    empty value would be a way to defeat that from inside the control. */}
                {GENDERS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {GENDER_LABEL[option]}
                  </MenuItem>
                ))}
                {/* A legacy value the dropdown does not offer would otherwise make the
                    select render BLANK and a save would silently clear it. Carried as its
                    own option so it survives an edit that does not touch this field. */}
                {legacyGender && (
                  <MenuItem value={legacyGender}>{legacyGender} (as recorded)</MenuItem>
                )}
              </TextField>
              <TextField
                label="Civil status"
                value={draft.civil_status}
                onChange={(e) => set('civil_status', e.target.value)}
                required
                fullWidth
                error={Boolean(fieldErrors.civil_status)}
                helperText={fieldErrors.civil_status?.join(' ')}
              />
              {/* D39 (Meeting #2 item 8) — the same vocabulary the student form uses.
                  `religionChoices` keeps whatever the draft already holds, so reopening
                  a saved application never opens this select blank and blanks the
                  religion on the next save. */}
              <TextField
                label="Religion"
                select
                value={draft.religion}
                onChange={(e) => set('religion', e.target.value)}
                required
                fullWidth
                error={Boolean(fieldErrors.religion)}
                helperText={
                  fieldErrors.religion?.join(' ') ??
                  (religionChoices.length === 0 ? 'No religions configured yet.' : undefined)
                }
              >
                {religionChoices.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
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
                // D39 (Meeting #2 item 2): this used to read "Becomes the student's login
                // when the application is accepted." An application can be DENIED, so
                // presenting the applicant's personal address as a login-in-waiting at
                // registration time promises an account that may never exist. It is a
                // contact address; the Dean chooses the login (defaulting to this one) in
                // the Accept dialog, and no `users` row is created before that.
                helperText="Contact address. It is not a login — an account is only issued if the application is accepted."
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
            {/* Stacked, not side by side: the CSEC count sits BELOW the ATLIB checkbox
                (client ask, D38). The two are separate questions, and a checkbox beside a
                number field reads as though the number qualifies the checkbox. */}
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
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
                helperText="Part Time is under 15 credits a session; Full Time is over 15."
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

            {/* D38 — this list is AS OF THE LAST SAVE, and says so. It arrives with the
                saved record, so on a form being typed for the first time there is nothing
                to show yet, and on a re-opened one it describes what was on disk rather
                than what is on screen. Recomputing it in the browser is how the two
                start disagreeing, which is exactly what the server owning it prevents. */}
            {savedIssues.length > 0 && (
              <Alert severity="warning">
                <AlertTitle>Still needed before this can be submitted</AlertTitle>
                <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
                  {savedIssues
                    .filter((issue) => !issue.startsWith('The application must be submitted'))
                    .map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  As of the last save. Save and submit re-checks everything and will list
                  anything still outstanding.
                </Typography>
              </Alert>
            )}
          </Stack>
        )}
      </Paper>

      {/* D38 — the footer is where the new save model is visible.
          *Continue* writes nothing; the two save actions exist only on the last step, so
          there is exactly one place in the flow where the form reaches the database. */}
      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
        <Button onClick={back} disabled={step === 0 || saving}>
          Back
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {saving && <CircularProgress size={18} />}
        {isLast ? (
          <>
            <Tooltip title={personalInfoComplete ? '' : PERSONAL_INFO_HINT}>
              <span>
                <Button
                  onClick={() => void finish()}
                  disabled={saving || !personalInfoComplete}
                >
                  Save and close
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={personalInfoComplete ? '' : PERSONAL_INFO_HINT}>
              <span>
                <Button
                  variant="contained"
                  onClick={() => void submitNow()}
                  disabled={saving || !personalInfoComplete}
                >
                  Save and submit
                </Button>
              </span>
            </Tooltip>
          </>
        ) : (
          <Tooltip title={step === 0 && !personalInfoComplete ? PERSONAL_INFO_HINT : ''}>
            <span>
              <Button
                variant="contained"
                onClick={next}
                disabled={saving || (step === 0 && !personalInfoComplete)}
              >
                Continue
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>
    </PageContainer>
  );
}

export default ApplicationWizardScreen;

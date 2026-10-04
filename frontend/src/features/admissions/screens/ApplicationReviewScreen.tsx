import { useState } from 'react';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  ErrorState,
  FormDialog,
  LoadingState,
  PageContainer,
  PageHeader,
  StatusBadge,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { AcceptDialog } from '../components/AcceptDialog';
import { CreditTransferPanel } from '../components/CreditTransferPanel';
import {
  useApplication,
  useRejectApplication,
  useRequestDocuments,
  useMarkEligible,
  useDeferApplication,
  useMarkEnrolled,
  useReviewApplication,
  useSubmitApplication,
  useWithdrawApplication,
} from '../hooks/useAdmissions';
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_KIND,
  isDecidedApplication,
  DOCUMENT_TYPES,
} from '../types';

/**
 * The application review screen — where a decision gets made (§D11).
 *
 * `blocking_issues` from the server is rendered VERBATIM at the top. That is the whole
 * design: the rules (under-18 guardian signature, a chosen programme, an email to issue a
 * login, no credit transfer left undecided) live in one place, and this screen explains a
 * disabled Accept button by quoting them rather than re-deriving them and eventually
 * disagreeing.
 */
/** D44 — the three transitions that take a note, so one dialog can serve all of them. */
type NoteAction = 'reject' | 'defer' | 'documents';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h4" component="h3" sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

export function ApplicationReviewScreen() {
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDean = user?.role === 'principal';

  const query = useApplication(applicationId);
  const submitMut = useSubmitApplication();
  const reviewMut = useReviewApplication();
  const rejectMut = useRejectApplication();
  const documentsMut = useRequestDocuments();
  const eligibleMut = useMarkEligible();
  const deferMut = useDeferApplication();
  const enrolledMut = useMarkEnrolled();
  const withdrawMut = useWithdrawApplication();

  const [acceptOpen, setAcceptOpen] = useState(false);
  /**
   * D44 — ONE dialog for the three transitions that carry a note (reject, defer, send
   * back for documents), rather than three near-identical ones. `noteAction` says which is
   * open and drives the copy; null means closed.
   */
  const [noteAction, setNoteAction] = useState<NoteAction | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) return <LoadingState variant="page" label="Loading application" />;
  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <ErrorState
          title="Application not found"
          message="It may have been removed from the list."
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  const app = query.data;
  const isDraft = app.status === 'draft';
  /**
   * D44 — `eligible` joins the decidable set. Refusing to decide from it would make
   * marking someone eligible a step BACKWARDS. `documents_pending` is deliberately absent:
   * a decision taken there is taken on a file the college knows it has not finished
   * reading. Mirrors `admissions/service._DECIDABLE`.
   */
  const isDecidable =
    app.status === 'submitted' || app.status === 'under_review' || app.status === 'eligible';
  const isReviewable = app.status === 'submitted' || app.status === 'under_review';
  const isDecided = isDecidedApplication(app.status);
  const canAccept = isDecidable && app.blocking_issues.length === 0;

  /**
   * D44 — THE EDIT AFFORDANCE. The server has always allowed a PATCH right up until a
   * decision is recorded (`_assert_editable`); until now the only button that used it
   * rendered on a draft, so an application under review was editable by the API and not by
   * anyone using it.
   *
   * Gated on the two roles that own admissions rather than on the route alone: the Auditor
   * reaches this page and every write it could make is refused centrally, so offering the
   * button would be offering a dead end.
   */
  const canEdit = !isDecided && (user?.role === 'principal' || user?.role === 'secretary');

  const noteCopy: Record<NoteAction, { title: string; submit: string; hint: string }> = {
    reject: {
      title: 'Reject this application',
      submit: 'Reject',
      hint: 'Recorded on the application. The applicant usually asks why.',
    },
    defer: {
      title: 'Defer this application',
      submit: 'Defer',
      hint:
        'The applicant re-applies for the intake you are deferring them to — this ' +
        'application is closed, not paused. Say which intake.',
    },
    documents: {
      title: 'Send back for documents',
      submit: 'Send back',
      hint: 'Say what is missing. The application returns to the queue once it arrives.',
    },
  };
  const runNote = () => {
    if (!noteAction) return;
    const reason = note.trim() || null;
    const mut =
      noteAction === 'reject' ? rejectMut : noteAction === 'defer' ? deferMut : documentsMut;
    mut.mutate(
      { id: app.id, reason },
      {
        onSuccess: () => {
          setNoteAction(null);
          setNote('');
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const grid = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 };

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
        title={app.full_name}
        subtitle={
          [
            app.program ? `${app.program.code} — ${app.program.name}` : 'No programme chosen',
            app.year_of_study,
            app.enrollment_load,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        primaryAction={
          canEdit ? (
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => navigate(`${ROUTES.applications}/${app.id}/edit`)}
            >
              {/* A draft is being FILLED IN; anything later is being CORRECTED, and the
                  two are different enough acts to name differently. */}
              {isDraft ? 'Continue filling in' : 'Edit application'}
            </Button>
          ) : undefined
        }
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <StatusBadge label={APPLICATION_STATUS_LABEL[app.status]} kind={APPLICATION_STATUS_KIND[app.status]} />
        {/* D44 — the reference the Registrar reads out on the phone. Monospaced so a
            digit-by-digit read-back is not fighting a proportional font. */}
        {app.application_number && (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {app.application_number}
          </Typography>
        )}
        {app.school_year && (
          <Typography variant="body2" color="text.secondary">
            School year {app.school_year}
          </Typography>
        )}
        {app.student_id && app.student_code && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PersonOutlineIcon />}
            component={RouterLink}
            to={`${ROUTES.students}/${app.student_id}`}
          >
            Student {app.student_code}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* The server's own answer to "why can't I accept this?" — quoted, never re-derived. */}
      {!isDecided && app.blocking_issues.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Outstanding before this can be accepted</AlertTitle>
          <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
            {app.blocking_issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </Box>
        </Alert>
      )}

      {app.status === 'accepted' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Accepted{app.date_accepted ? ` on ${app.date_accepted}` : ''}. Student ID{' '}
          <strong>{app.student_code}</strong>.
        </Alert>
      )}

      {/* ── Decision bar ─────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {isDraft && (
            <Button
              variant="contained"
              disabled={submitMut.isPending}
              onClick={() =>
                submitMut.mutate(app.id, { onError: (err) => setError(apiErrorMessage(err)) })
              }
            >
              Submit for a decision
            </Button>
          )}
          {app.status === 'submitted' && (
            <Button
              disabled={reviewMut.isPending}
              onClick={() =>
                reviewMut.mutate(app.id, { onError: (err) => setError(apiErrorMessage(err)) })
              }
            >
              Mark under review
            </Button>
          )}
          {/* D44 — the return trip from `documents_pending`. Same endpoint as
              "Mark under review", named for what it means here. */}
          {app.status === 'documents_pending' && (
            <Button
              variant="contained"
              disabled={reviewMut.isPending}
              onClick={() =>
                reviewMut.mutate(app.id, { onError: (err) => setError(apiErrorMessage(err)) })
              }
            >
              Documents received
            </Button>
          )}
          {isReviewable && (
            <>
              <Button
                disabled={eligibleMut.isPending}
                onClick={() =>
                  eligibleMut.mutate(app.id, {
                    onError: (err) => setError(apiErrorMessage(err)),
                  })
                }
              >
                Mark eligible
              </Button>
              <Button onClick={() => setNoteAction('documents')}>Request documents</Button>
            </>
          )}
          {isDecidable && (
            <>
              <Button
                variant="contained"
                color="success"
                disabled={!canAccept}
                onClick={() => setAcceptOpen(true)}
              >
                Accept
              </Button>
              <Button onClick={() => setNoteAction('defer')}>Defer</Button>
              <Button variant="outlined" color="error" onClick={() => setNoteAction('reject')}>
                Reject
              </Button>
            </>
          )}
          {/* D44 — the last step: the student the acceptance created has registered. */}
          {app.status === 'accepted' && app.student_id && (
            <Button
              variant="contained"
              disabled={enrolledMut.isPending}
              onClick={() =>
                enrolledMut.mutate(app.id, {
                  onError: (err) => setError(apiErrorMessage(err)),
                })
              }
            >
              Mark enrolled
            </Button>
          )}
          {!isDecided && (
            <Button
              color="inherit"
              disabled={withdrawMut.isPending}
              onClick={() =>
                withdrawMut.mutate(app.id, { onError: (err) => setError(apiErrorMessage(err)) })
              }
            >
              Applicant withdrew
            </Button>
          )}
          {isDecided && app.status !== 'accepted' && (
            <Typography variant="body2" color="text.secondary">
              This application is {APPLICATION_STATUS_LABEL[app.status].toLowerCase()} and is
              now a record. Decisions are kept, not reversed.
              {app.status === 'deferred' &&
                ' The applicant re-applies for the intake they were deferred to.'}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Stack spacing={2}>
        <Section title="Section A · Personal information">
          <Stack spacing={2}>
            <Box sx={grid}>
              <Field label="Date of birth" value={formatSchoolDate(app.date_of_birth)} />
              <Field label="Gender" value={app.gender} />
              <Field label="Civil status" value={app.civil_status} />
              <Field label="Religion" value={app.religion} />
              <Field label="Social Security no." value={app.ssno} />
              <Field label="Telephone" value={app.phone} />
              <Field label="E-mail" value={app.email} />
              <Field
                label="Address"
                value={[app.street, app.city_town_village, app.district].filter(Boolean).join(', ')}
              />
            </Box>
            <Divider />
            <Box sx={grid}>
              <Field label="Mother" value={app.mother_name} />
              <Field label="Father" value={app.father_name} />
              <Field
                label="Next of kin"
                value={
                  [app.nok_name, app.nok_relationship, app.nok_phone].filter(Boolean).join(' · ')
                }
              />
            </Box>
            {app.has_health_condition && (
              <Alert severity="info">
                <AlertTitle>Health or learning condition declared</AlertTitle>
                {app.health_condition_note || 'No detail given — a medical certificate is required.'}
              </Alert>
            )}
          </Stack>
        </Section>

        <Section title="Section B · Educational background">
          {app.education.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No institutions listed.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {app.education.map((row) => (
                <Box
                  key={row.id ?? row.institution}
                  sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'baseline' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {row.institution}
                  </Typography>
                  <StatusBadge
                    label={row.education_level}
                    kind={row.education_level === 'Tertiary' ? 'info' : 'neutral'}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {row.graduated
                      ? `Graduated ${formatSchoolDate(row.graduation_date)}`.trim()
                      : 'Not graduated'}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
          <Divider sx={{ my: 2 }} />
          <Box sx={grid}>
            <Field label="ATLIB exam" value={app.atlib_exam ? 'Yes' : 'No'} />
            <Field label="CSEC exams" value={app.num_csec} />
          </Box>
        </Section>

        <Section title="Section C · Financial information">
          <Box sx={grid}>
            <Field label="Financed by" value={app.finance_name} />
            <Field label="Telephone" value={app.finance_phone} />
            <Field label="E-mail" value={app.finance_email} />
          </Box>
        </Section>

        <Section title="Sections D and G · Recommendation and agreement">
          <Box sx={grid}>
            <Field
              label="Recommendation form"
              value={app.recommendation_received ? 'Received' : 'Not received'}
            />
            <Field label="Applicant signed" value={app.applicant_signed_at} />
            <Field label="Parent / guardian signed" value={app.guardian_signed_at} />
          </Box>
        </Section>

        <Section title="Section F · Documents">
          <Stack spacing={0.5}>
            {DOCUMENT_TYPES.map((type) => {
              const row = app.documents.find((d) => d.document_type === type.value);
              if (!row) return null;
              return (
                <Box key={type.value} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <StatusBadge
                    label={row.received ? 'Received' : 'Outstanding'}
                    kind={row.received ? 'success' : 'neutral'}
                  />
                  <Typography variant="body2">{type.label}</Typography>
                </Box>
              );
            })}
            {app.documents.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nothing ticked off yet.
              </Typography>
            )}
          </Stack>
        </Section>

        <Card variant="outlined">
          <CardContent>
            <CreditTransferPanel
              application={app}
              isDean={isDean}
              canEdit={!isDecided}
            />
          </CardContent>
        </Card>

        {app.comments && (
          <Section title="Comments and observations">
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
              {app.comments}
            </Typography>
          </Section>
        )}
      </Stack>

      <AcceptDialog
        open={acceptOpen}
        application={app}
        onClose={() => setAcceptOpen(false)}
        onAccepted={() => void query.refetch()}
      />

      {/* D44 — ONE dialog for reject / defer / request-documents. All three append a note
          to the same field through the same body shape; three copies of it would have been
          three places for the wording to drift. */}
      <FormDialog
        open={noteAction !== null}
        title={noteAction ? noteCopy[noteAction].title : ''}
        submitLabel={noteAction ? noteCopy[noteAction].submit : ''}
        submitting={rejectMut.isPending || deferMut.isPending || documentsMut.isPending}
        onClose={() => {
          setNoteAction(null);
          setNote('');
        }}
        onSubmit={runNote}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          {noteAction === 'reject' && (
            <Alert severity="warning">
              A rejection is kept as part of the admissions record and is not reversible. Use
              &ldquo;Applicant withdrew&rdquo; instead if they pulled out — the two are
              different facts.
            </Alert>
          )}
          {noteAction === 'defer' && (
            <Alert severity="info">
              Deferring CLOSES this application. The applicant files a new one for the intake
              you are deferring them to, and the duplicate check will let them.
            </Alert>
          )}
          {noteAction === 'documents' && (
            <Alert severity="info">
              The application leaves the decision queue until the paperwork arrives. Use
              &ldquo;Documents received&rdquo; to bring it back.
            </Alert>
          )}
          <TextField
            label={noteAction === 'documents' ? 'What is missing' : 'Reason'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText={noteAction ? noteCopy[noteAction].hint : ''}
          />
        </Stack>
      </FormDialog>
    </PageContainer>
  );
}

export default ApplicationReviewScreen;

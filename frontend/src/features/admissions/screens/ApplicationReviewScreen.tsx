import { useState } from 'react';
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
  type StatusKind,
} from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { AcceptDialog } from '../components/AcceptDialog';
import { CreditTransferPanel } from '../components/CreditTransferPanel';
import {
  useApplication,
  useDenyApplication,
  useReviewApplication,
  useSubmitApplication,
  useWithdrawApplication,
} from '../hooks/useAdmissions';
import {
  APPLICATION_STATUS_LABEL,
  DOCUMENT_TYPES,
  type ApplicationStatus,
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
const STATUS_KIND: Record<ApplicationStatus, StatusKind> = {
  draft: 'neutral',
  submitted: 'info',
  under_review: 'warning',
  accepted: 'success',
  denied: 'error',
  withdrawn: 'neutral',
};

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
  const denyMut = useDenyApplication();
  const withdrawMut = useWithdrawApplication();

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState('');
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
  const isDecidable = app.status === 'submitted' || app.status === 'under_review';
  const isDecided = ['accepted', 'denied', 'withdrawn'].includes(app.status);
  const canAccept = isDecidable && app.blocking_issues.length === 0;

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
          isDraft ? (
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => navigate(`${ROUTES.applications}/${app.id}/edit`)}
            >
              Continue filling in
            </Button>
          ) : undefined
        }
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <StatusBadge label={APPLICATION_STATUS_LABEL[app.status]} kind={STATUS_KIND[app.status]} />
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
              <Button variant="outlined" color="error" onClick={() => setDenyOpen(true)}>
                Deny
              </Button>
            </>
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
          {isDecided && (
            <Typography variant="body2" color="text.secondary">
              This application is {app.status} and is now a record. Decisions are kept, not
              reversed.
            </Typography>
          )}
        </Stack>
      </Paper>

      <Stack spacing={2}>
        <Section title="Section A · Personal information">
          <Stack spacing={2}>
            <Box sx={grid}>
              <Field label="Date of birth" value={app.date_of_birth} />
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
                    {row.graduated ? `Graduated ${row.graduation_date ?? ''}` : 'Not graduated'}
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

      <FormDialog
        open={denyOpen}
        title="Deny this application"
        submitLabel="Deny"
        submitting={denyMut.isPending}
        onClose={() => setDenyOpen(false)}
        onSubmit={() =>
          denyMut.mutate(
            { id: app.id, reason: denyReason.trim() || null },
            {
              onSuccess: () => {
                setDenyOpen(false);
                setDenyReason('');
              },
              onError: (err) => setError(apiErrorMessage(err)),
            },
          )
        }
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning">
            A denial is kept as part of the admissions record and is not reversible. Use
            &ldquo;Applicant withdrew&rdquo; instead if they pulled out — the two are different
            facts.
          </Alert>
          <TextField
            label="Reason"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="Optional, but the applicant usually asks. Appended to the comments."
          />
        </Stack>
      </FormDialog>
    </PageContainer>
  );
}

export default ApplicationReviewScreen;

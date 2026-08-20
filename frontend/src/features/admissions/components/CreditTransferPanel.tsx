import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { EmptyState, FormDialog, StatusBadge } from '@shared/components';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { useCoursesList } from '@features/settings/hooks/useCourses';
import {
  useCreateCreditTransfer,
  useDecideCreditTransfer,
  useDeleteCreditTransfer,
} from '../hooks/useAdmissions';
import {
  MIN_EQUIVALENCY_PCT,
  type ApplicationDetail,
  type CreditTransfer,
  type CreditTransferStatus,
} from '../types';

/**
 * Credit transfer on one application (brief §13, §D11).
 *
 * **Two audiences on one panel, and the split is the point.** The Registrar FILES what the
 * applicant claims; the **Dean alone** approves or denies (§D14). So the Add button is
 * shown to both and the decision controls only to the Dean — a Registrar who could press
 * Approve would just collect a 403.
 *
 * The ≥75% content-equivalency floor is surfaced BEFORE the press: the server returns
 * `meets_equivalency_floor`, and Approve is disabled with the reason in a tooltip rather
 * than the Dean discovering it from a 422. The percentage can be entered with the
 * decision, which is the normal path — assess and rule in one action.
 */
export interface CreditTransferPanelProps {
  application: ApplicationDetail;
  /** Whether the viewer is the Dean. Decisions are theirs alone (brief §13). */
  isDean: boolean;
  /** False once the application is decided — transfers are an ADMISSION-time thing. */
  canEdit: boolean;
}

const STATUS_KIND: Record<CreditTransferStatus, 'info' | 'success' | 'error'> = {
  pending: 'info',
  approved: 'success',
  denied: 'error',
};

export function CreditTransferPanel({ application, isDean, canEdit }: CreditTransferPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [decide, setDecide] = useState<{ transfer: CreditTransfer; approve: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coursesQuery = useCoursesList({ page: 1, page_size: 200 });
  const createMut = useCreateCreditTransfer();
  const decideMut = useDecideCreditTransfer();
  const deleteMut = useDeleteCreditTransfer();

  // ── add form ────────────────────────────────────────────────────────────────
  const [institution, setInstitution] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [credits, setCredits] = useState('');
  const [grade, setGrade] = useState('');
  const [targetCourseId, setTargetCourseId] = useState('');
  const [equivalency, setEquivalency] = useState('');

  // ── decision form ───────────────────────────────────────────────────────────
  const [decisionPct, setDecisionPct] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  const resetAdd = () => {
    setInstitution('');
    setCourseName('');
    setCourseCode('');
    setCredits('');
    setGrade('');
    setTargetCourseId('');
    setEquivalency('');
  };

  const submitAdd = () => {
    setError(null);
    createMut.mutate(
      {
        applicationId: application.id,
        body: {
          external_institution: institution.trim(),
          external_course_name: courseName.trim(),
          external_course_code: courseCode.trim() || null,
          external_credits: credits.trim() === '' ? null : Number(credits),
          external_grade: grade.trim() || null,
          target_course_id: targetCourseId,
          content_equivalency_pct: equivalency.trim() === '' ? null : Number(equivalency),
          // Attach whatever CTA / transcript / outline rows the checklist already has, so
          // the Dean sees the papers cited without a second step. The server verifies each
          // belongs to THIS application.
          cta_document_id: application.documents.find((d) => d.document_type === 'cta')?.id ?? null,
          transcript_document_id:
            application.documents.find((d) => d.document_type === 'transcript')?.id ?? null,
          outline_document_id:
            application.documents.find((d) => d.document_type === 'course_outline')?.id ?? null,
        },
      },
      {
        onSuccess: () => {
          resetAdd();
          setAddOpen(false);
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const submitDecision = () => {
    if (!decide) return;
    setError(null);
    decideMut.mutate(
      {
        transferId: decide.transfer.id,
        body: {
          status: decide.approve ? 'approved' : 'denied',
          content_equivalency_pct: decisionPct.trim() === '' ? null : Number(decisionPct),
          note: decisionNote.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDecide(null);
          setDecisionPct('');
          setDecisionNote('');
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const transfers = application.credit_transfers;
  const pending = transfers.filter((t) => t.status === 'pending');

  /** The percentage that WOULD apply if the Dean approved now — typed, else stored. */
  const effectivePct = (transfer: CreditTransfer) =>
    decisionPct.trim() !== '' ? Number(decisionPct) : transfer.content_equivalency_pct;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Typography variant="h4" component="h3">
          Credit transfer
        </Typography>
        {pending.length > 0 && (
          <Chip size="small" color="warning" label={`${pending.length} awaiting the Dean`} />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {canEdit && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
            Add request
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!canEdit && transfers.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No credit transfer was requested. Policy allows it at admission only, so it can no
          longer be added.
        </Typography>
      ) : transfers.length === 0 ? (
        <EmptyState
          variant="card"
          title="No credit transfer requested"
          description="Credit may transfer from a recognised tertiary institution at ≥75% content equivalency, and only at admission. The Dean decides."
        />
      ) : (
        <Stack spacing={1.5}>
          {transfers.map((transfer) => (
            <Card key={transfer.id} variant="outlined">
              <CardContent>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {transfer.external_course_code
                        ? `${transfer.external_course_code} — `
                        : ''}
                      {transfer.external_course_name}
                    </Typography>
                    <StatusBadge
                      label={transfer.status}
                      kind={STATUS_KIND[transfer.status]}
                    />
                    <Box sx={{ flexGrow: 1 }} />
                    {transfer.content_equivalency_pct != null && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color={transfer.meets_equivalency_floor ? 'success' : 'default'}
                        label={`${transfer.content_equivalency_pct}% equivalent`}
                      />
                    )}
                  </Stack>

                  <Typography variant="body2" color="text.secondary">
                    From <strong>{transfer.external_institution}</strong>
                    {transfer.external_credits != null && ` · ${transfer.external_credits} credits`}
                    {transfer.external_grade && ` · graded ${transfer.external_grade}`}
                  </Typography>

                  <Typography variant="body2">
                    Would satisfy{' '}
                    <strong>
                      {transfer.target_course
                        ? `${transfer.target_course.code} — ${transfer.target_course.name}`
                        : 'an unknown course'}
                    </strong>
                    {transfer.target_course?.credits != null &&
                      ` (${transfer.target_course.credits} credits)`}
                  </Typography>

                  {transfer.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                      {transfer.note}
                    </Typography>
                  )}

                  {transfer.status === 'pending' && (isDean || canEdit) && (
                    <>
                      <Divider />
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {isDean && (
                          <>
                            <Tooltip
                              title={
                                transfer.meets_equivalency_floor
                                  ? 'Approve — the credit will count toward the award'
                                  : `Approval needs at least ${MIN_EQUIVALENCY_PCT}% content equivalency (brief §13). Record the assessment first.`
                              }
                            >
                              <span>
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="success"
                                  onClick={() => {
                                    setDecisionPct(
                                      transfer.content_equivalency_pct == null
                                        ? ''
                                        : String(transfer.content_equivalency_pct),
                                    );
                                    setDecide({ transfer, approve: true });
                                  }}
                                >
                                  Approve
                                </Button>
                              </span>
                            </Tooltip>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                setDecisionPct(
                                  transfer.content_equivalency_pct == null
                                    ? ''
                                    : String(transfer.content_equivalency_pct),
                                );
                                setDecide({ transfer, approve: false });
                              }}
                            >
                              Deny
                            </Button>
                          </>
                        )}
                        {!isDean && (
                          <Typography variant="caption" color="text.secondary">
                            Awaiting the Dean's decision — only they may approve or deny a
                            credit transfer.
                          </Typography>
                        )}
                        <Box sx={{ flexGrow: 1 }} />
                        {canEdit && (
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            disabled={deleteMut.isPending}
                            onClick={() =>
                              deleteMut.mutate(transfer.id, {
                                onError: (err) => setError(apiErrorMessage(err)),
                              })
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </Stack>
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* ── Add ──────────────────────────────────────────────────────────────── */}
      <FormDialog
        open={addOpen}
        title="Request credit transfer"
        submitLabel="File request"
        submitting={createMut.isPending}
        submitDisabled={
          institution.trim() === '' || courseName.trim() === '' || targetCourseId === ''
        }
        maxWidth="md"
        onClose={() => {
          resetAdd();
          setAddOpen(false);
        }}
        onSubmit={submitAdd}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="info">
            Policy: studied and passed at a recognised <strong>tertiary</strong> institution,
            ≥{MIN_EQUIVALENCY_PCT}% content equivalency, applied for at admission only, with a
            CTA, the original transcript and course outlines. <strong>The Dean decides.</strong>
          </Alert>
          <TextField
            label="External institution"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            required
            fullWidth
            autoFocus
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="External course code"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              fullWidth
            />
            <TextField
              label="External course name"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              required
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="External credits"
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              inputProps={{ min: 0, max: 99 }}
              fullWidth
            />
            <TextField
              label="Grade earned"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              fullWidth
              helperText="As the transcript writes it — another institution's scale is not BAJC's."
            />
          </Stack>
          <TextField
            select
            label="BAJC course this would satisfy"
            value={targetCourseId}
            onChange={(e) => setTargetCourseId(e.target.value)}
            required
            fullWidth
            helperText="Required: an approval that names no course means nothing to the curriculum."
          >
            <MenuItem value="">—</MenuItem>
            {(coursesQuery.data?.items ?? []).map((course) => (
              <MenuItem key={course.id} value={course.id}>
                {course.code} — {course.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Content equivalency (%)"
            type="number"
            value={equivalency}
            onChange={(e) => setEquivalency(e.target.value)}
            inputProps={{ min: 0, max: 100, step: 0.5 }}
            fullWidth
            helperText={`Optional now — the Dean assesses it. At least ${MIN_EQUIVALENCY_PCT}% is needed to approve.`}
          />
        </Stack>
      </FormDialog>

      {/* ── Decide (Dean) ────────────────────────────────────────────────────── */}
      <FormDialog
        open={decide !== null}
        title={decide?.approve ? 'Approve credit transfer' : 'Deny credit transfer'}
        submitLabel={decide?.approve ? 'Approve' : 'Deny'}
        submitting={decideMut.isPending}
        submitDisabled={
          decide?.approve
            ? // Mirrors `ck_cta_approval_requires_75` and the service check, so the Dean is
              // told the rule instead of meeting it as a 422.
              (effectivePct(decide.transfer) ?? -1) < MIN_EQUIVALENCY_PCT
            : false
        }
        onClose={() => setDecide(null)}
        onSubmit={submitDecision}
      >
        {decide && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              {decide.transfer.external_course_name} from{' '}
              {decide.transfer.external_institution}, toward{' '}
              <strong>{decide.transfer.target_course?.code ?? '—'}</strong>.
            </Typography>
            <TextField
              label="Content equivalency (%)"
              type="number"
              value={decisionPct}
              onChange={(e) => setDecisionPct(e.target.value)}
              inputProps={{ min: 0, max: 100, step: 0.5 }}
              fullWidth
              required={decide.approve}
              error={
                decide.approve && (effectivePct(decide.transfer) ?? -1) < MIN_EQUIVALENCY_PCT
              }
              helperText={
                decide.approve
                  ? `At least ${MIN_EQUIVALENCY_PCT}% is required to approve (brief §13).`
                  : 'Optional on a denial.'
              }
            />
            <TextField
              label="Note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="Appended to the request — earlier notes are kept."
            />
            {decide.approve && (
              <Alert severity="info">
                Approval also requires a tertiary institution on Section B. If none is listed
                the server will refuse and say so.
              </Alert>
            )}
          </Stack>
        )}
      </FormDialog>
    </Box>
  );
}

export default CreditTransferPanel;

import { useEffect, useMemo, useState } from 'react';
import { formatSchoolDate } from '@shared/utils/schoolDate';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItem,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@shared/components';
import { useYearFilter } from '@shared/hooks';
import { apiErrorMessage } from '@shared/api/errorMessages';
import { attendanceRecordableDates, schoolToday } from '@shared/utils/schoolDate';
import type { AttendanceStatus } from '@shared/types/enums';
import {
  useAttendanceRegister,
  useAttendanceOfferings,
  useSaveAttendance,
} from '../hooks/useAttendance';
import { AttendanceToolbar } from '../components/AttendanceToolbar';
import { AttendanceStatusToggle } from '../components/AttendanceStatusToggle';
import { ATTENDANCE_STATUS_META, DEFAULT_STATUS } from '../attendanceStatus';

/**
 * Local, editable copy of each row's status keyed by student id. `null` = not entered
 * yet — the client asked that nothing be pre-selected, so an unrecorded student starts
 * blank and Save refuses until every row has a status.
 */
type Draft = Record<string, AttendanceStatus | null>;

function formatRecordedAt(iso: string): string {
  // D39 (Meeting #2 item 1) — dd/mm/yyyy.
  return formatSchoolDate(iso);
}

/**
 * Attendance entry sheet (design-system §7.6) — tablet-first daily register for one
 * (offering, date). Unrecorded rows start with NO status selected (client request,
 * 14 Oct 2026 — replaces FR-ATT-02's "default Present"); the lecturer taps each one or
 * uses "Mark all present", sees running counts, and Saves via PUT /attendance (upsert,
 * FR-ATT-03). Save is refused while any row is blank. Only today and the previous school
 * day can be chosen — future dates (FR-ATT-05) and older ones are closed. P/S land here read-only and
 * are steered to the Summary tab (they view-all, they do not record).
 *
 * Selection persists to the URL (?offering_id=&date=) so the sheet is shareable/reloadable.
 */
export function AttendanceRegisterScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const offeringId = searchParams.get('offering_id');
  // Defaults to the school-local today (America/Belize), matching the backend's
  // `school_today()`. Previously the demo dataset's fixed 2025-10-15, so against the
  // real API the register opened on a date months in the past.
  const requestedDate = searchParams.get('date') ?? schoolToday();
  // A URL or a typed value can still name a closed date — fall back to today rather
  // than load (and offer to save) a register outside the window.
  const date = attendanceRecordableDates().includes(requestedDate) ? requestedDate : schoolToday();

  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();
  const offeringsQuery = useAttendanceOfferings(yearId);
  const registerQuery = useAttendanceRegister(offeringId, date);
  const saveMut = useSaveAttendance();

  // Switching year clears the (year-specific) offering so the effect re-picks one.
  const handleChangeYear = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('year', value);
        next.delete('offering_id');
        return next;
      },
      { replace: true },
    );

  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when Save was pressed with blank rows; drives the alert and row outlines. */
  const [showMissing, setShowMissing] = useState(false);

  const canRecord = registerQuery.data?.can_record ?? offeringsQuery.data?.can_record ?? false;

  // Preselect the caller's first available class (keeps the URL the source of truth).
  //
  // This `items[0]` is NOT the retired "a student has one homeroom" assumption that D29
  // removed elsewhere — it just picks a starting class for the picker, which the user then
  // changes. Every class in the list is equally valid; there is no primary one.
  useEffect(() => {
    if (!offeringId && offeringsQuery.data && offeringsQuery.data.items.length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('offering_id', offeringsQuery.data!.items[0]!.offering.id);
          if (!next.get('date')) next.set('date', schoolToday());
          return next;
        },
        { replace: true },
      );
    }
  }, [offeringId, offeringsQuery.data, setSearchParams]);

  // Seed the editable draft from the loaded register (unrecorded → blank, not Present).
  useEffect(() => {
    if (registerQuery.data) {
      const seeded: Draft = {};
      for (const entry of registerQuery.data.entries) {
        seeded[entry.student.id] = entry.status ?? null;
      }
      setDraft(seeded);
      setShowMissing(false);
    }
  }, [registerQuery.data]);

  const entries = registerQuery.data?.entries ?? [];

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, missing: 0 };
    for (const entry of entries) {
      const status = draft[entry.student.id] ?? null;
      if (status === null) c.missing += 1;
      else c[status] += 1;
    }
    return c;
  }, [entries, draft]);

  // The warning clears itself once the last blank row is filled in.
  useEffect(() => {
    if (counts.missing === 0) setShowMissing(false);
  }, [counts.missing]);

  const isDirty = useMemo(() => {
    if (!registerQuery.data) return false;
    return registerQuery.data.entries.some(
      (entry) => (entry.status ?? null) !== (draft[entry.student.id] ?? null),
    );
  }, [registerQuery.data, draft]);

  const setStatus = (studentId: string, status: AttendanceStatus) =>
    setDraft((prev) => ({ ...prev, [studentId]: status }));

  const markAllPresent = () =>
    setDraft(Object.fromEntries(entries.map((e) => [e.student.id, DEFAULT_STATUS] as const)));

  const handleChangeOffering = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('offering_id', value);
      return next;
    });

  const handleChangeDate = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('date', value);
      return next;
    });

  const handleSave = () => {
    if (!offeringId) return;
    setError(null);
    if (counts.missing > 0) {
      setShowMissing(true);
      return;
    }
    saveMut.mutate(
      {
        offering_id: offeringId,
        date,
        entries: entries.map((e) => ({
          student_id: e.student.id,
          // Non-null: the guard above refuses the save while any row is blank.
          status: draft[e.student.id] as AttendanceStatus,
        })),
      },
      {
        onSuccess: (res) => {
          const section = registerQuery.data?.offering.offering.label ?? 'this offering';
          setSaved(`Attendance saved for ${section} · ${res.upserted} students`);
        },
        onError: (err) => setError(apiErrorMessage(err)),
      },
    );
  };

  const handleCancel = () => {
    if (!registerQuery.data) return;
    setDraft(
      Object.fromEntries(
        registerQuery.data.entries.map((e) => [e.student.id, e.status ?? null] as const),
      ),
    );
    setShowMissing(false);
  };

  // ── UI states ────────────────────────────────────────────────────────────────
  if (offeringsQuery.isLoading) return <LoadingState variant="page" label="Loading course offerings" />;
  if (offeringsQuery.isError) {
    return <ErrorState onRetry={() => void offeringsQuery.refetch()} />;
  }
  if (offeringsQuery.data && offeringsQuery.data.items.length === 0) {
    return (
      <>
        <PageHeader title="Record attendance" />
        <EmptyState
          variant="page"
          title="No classes to show"
          description="You don't have any classes assigned to record attendance for."
        />
      </>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title={canRecord ? 'Record attendance' : 'Attendance'}
        subtitle={
          registerQuery.data
            ? `${registerQuery.data.offering.offering.label} · ${entries.length} students`
            : 'Per-day register for one subject class'
        }
      />

      <AttendanceToolbar
        offerings={offeringsQuery.data?.items ?? []}
        offeringId={offeringId}
        onOfferingChange={handleChangeOffering}
        date={date}
        onDateChange={handleChangeDate}
        years={years}
        yearId={yearId}
        activeYearId={activeYearId}
        onYearChange={handleChangeYear}
        yearsLoading={yearsLoading}
      />

      {!canRecord && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You have view-only access. Open the Summary tab for attendance trends.
        </Alert>
      )}

      {error && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {showMissing && counts.missing > 0 && (
        <Alert severity="warning" role="alert" sx={{ mb: 2 }}>
          Some students' attendance has not been entered ({counts.missing} of {entries.length}).
          Choose a status for every highlighted student before saving.
        </Alert>
      )}

      {registerQuery.isLoading && <LoadingState variant="table" rows={6} />}
      {registerQuery.isError && (
        <ErrorState
          message="We couldn't load the register for this class and date."
          onRetry={() => void registerQuery.refetch()}
        />
      )}

      {registerQuery.data && (
        <>
          {registerQuery.data.last_recorded && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Last recorded by {registerQuery.data.last_recorded.by} on{' '}
              {formatRecordedAt(registerQuery.data.last_recorded.at)}.
            </Typography>
          )}

          {canRecord && (
            <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Choose a status for every student.
              </Typography>
              <Button size="small" onClick={markAllPresent} disabled={entries.length === 0}>
                Mark all present
              </Button>
            </Stack>
          )}

          {entries.length === 0 ? (
            <EmptyState
              title="No students enrolled"
              description="This class has no active students to record attendance for."
            />
          ) : (
            <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <List disablePadding aria-label="Attendance register">
                {entries.map((entry, i) => (
                  <Box key={entry.student.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', md: 'row' },
                        alignItems: { xs: 'stretch', md: 'center' },
                        gap: { xs: 1, md: 2 },
                        py: 1.5,
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 500 }}>
                          {entry.student.full_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.student.student_number}
                        </Typography>
                      </Box>
                      <Box sx={{ width: { xs: '100%', md: 'auto' }, flexShrink: 0 }}>
                        <AttendanceStatusToggle
                          value={draft[entry.student.id] ?? null}
                          onChange={(status) => setStatus(entry.student.id, status)}
                          disabled={!canRecord || saveMut.isPending}
                          error={showMissing && (draft[entry.student.id] ?? null) === null}
                          ariaLabel={`Attendance status for ${entry.student.full_name}`}
                        />
                      </Box>
                    </ListItem>
                  </Box>
                ))}
              </List>
            </Paper>
          )}

          {/* Sticky save bar with a running count (design-system §7.6). */}
          {canRecord && entries.length > 0 && (
            <Paper
              elevation={3}
              sx={{
                position: 'sticky',
                bottom: 0,
                mt: 2,
                p: 1.5,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.5,
                alignItems: 'center',
                justifyContent: 'space-between',
                zIndex: (t) => t.zIndex.appBar - 1,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {ATTENDANCE_STATUS_META.map((meta) => (
                  <Chip
                    key={meta.value}
                    icon={meta.icon}
                    color={meta.color}
                    variant="outlined"
                    size="small"
                    label={`${counts[meta.value]} ${meta.label}`}
                  />
                ))}
                {counts.missing > 0 && (
                  <Chip color="warning" size="small" label={`${counts.missing} Not entered`} />
                )}
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button onClick={handleCancel} disabled={!isDirty || saveMut.isPending}>
                  Cancel
                </Button>
                <Button variant="contained" onClick={handleSave} disabled={saveMut.isPending}>
                  {saveMut.isPending ? 'Saving…' : 'Save'}
                </Button>
              </Stack>
            </Paper>
          )}
        </>
      )}

      <Snackbar
        open={saved !== null}
        autoHideDuration={3000}
        onClose={() => setSaved(null)}
        message={saved ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}

export default AttendanceRegisterScreen;

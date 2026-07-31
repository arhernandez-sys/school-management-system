import { useEffect, useMemo, useState } from 'react';
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
import { schoolToday } from '@shared/utils/schoolDate';
import type { AttendanceStatus } from '@shared/types/enums';
import {
  useAttendanceRegister,
  useAttendanceSections,
  useSaveAttendance,
} from '../hooks/useAttendance';
import { AttendanceToolbar } from '../components/AttendanceToolbar';
import { AttendanceStatusToggle } from '../components/AttendanceStatusToggle';
import { ATTENDANCE_STATUS_META, DEFAULT_STATUS } from '../attendanceStatus';

/** Local, editable copy of each row's status keyed by student id. */
type Draft = Record<string, AttendanceStatus>;

function formatRecordedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Attendance entry sheet (design-system §7.6) — tablet-first daily register for one
 * (section, date). All rows default to Present (FR-ATT-02); the teacher taps to change
 * a status, can "Mark all present", sees running counts, and Saves via PUT /attendance
 * (upsert, FR-ATT-03). Future dates are blocked (FR-ATT-05). P/S land here read-only and
 * are steered to the Summary tab (they view-all, they do not record).
 *
 * Selection persists to the URL (?section_id=&date=) so the sheet is shareable/reloadable.
 */
export function AttendanceRegisterScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionId = searchParams.get('section_id');
  // Defaults to the school-local today (America/Belize), matching the backend's
  // `school_today()`. Previously the demo dataset's fixed 2025-10-15, so against the
  // real API the register opened on a date months in the past.
  const date = searchParams.get('date') ?? schoolToday();

  const { yearId, years, activeYearId, isLoading: yearsLoading } = useYearFilter();
  const sectionsQuery = useAttendanceSections(yearId);
  const registerQuery = useAttendanceRegister(sectionId, date);
  const saveMut = useSaveAttendance();

  // Switching year clears the (year-specific) section so the effect re-picks one.
  const handleChangeYear = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('year', value);
        next.delete('section_id');
        return next;
      },
      { replace: true },
    );

  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRecord = registerQuery.data?.can_record ?? sectionsQuery.data?.can_record ?? false;

  // Default the section to the caller's first available one (keeps the URL the source of truth).
  useEffect(() => {
    if (!sectionId && sectionsQuery.data && sectionsQuery.data.items.length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('section_id', sectionsQuery.data!.items[0]!.id);
          if (!next.get('date')) next.set('date', schoolToday());
          return next;
        },
        { replace: true },
      );
    }
  }, [sectionId, sectionsQuery.data, setSearchParams]);

  // Seed the editable draft from the loaded register (unrecorded → default Present).
  useEffect(() => {
    if (registerQuery.data) {
      const seeded: Draft = {};
      for (const entry of registerQuery.data.entries) {
        seeded[entry.student.id] = entry.status ?? DEFAULT_STATUS;
      }
      setDraft(seeded);
    }
  }, [registerQuery.data]);

  const entries = registerQuery.data?.entries ?? [];

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const entry of entries) {
      const status = draft[entry.student.id] ?? DEFAULT_STATUS;
      c[status] += 1;
    }
    return c;
  }, [entries, draft]);

  const isDirty = useMemo(() => {
    if (!registerQuery.data) return false;
    return registerQuery.data.entries.some(
      (entry) => (entry.status ?? DEFAULT_STATUS) !== (draft[entry.student.id] ?? DEFAULT_STATUS),
    );
  }, [registerQuery.data, draft]);

  const setStatus = (studentId: string, status: AttendanceStatus) =>
    setDraft((prev) => ({ ...prev, [studentId]: status }));

  const markAllPresent = () =>
    setDraft(Object.fromEntries(entries.map((e) => [e.student.id, DEFAULT_STATUS] as const)));

  const handleChangeSection = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section_id', value);
      return next;
    });

  const handleChangeDate = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('date', value);
      return next;
    });

  const handleSave = () => {
    if (!sectionId) return;
    setError(null);
    saveMut.mutate(
      {
        section_id: sectionId,
        date,
        entries: entries.map((e) => ({
          student_id: e.student.id,
          status: draft[e.student.id] ?? DEFAULT_STATUS,
        })),
      },
      {
        onSuccess: (res) => {
          const section = registerQuery.data?.section.name ?? 'class';
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
        registerQuery.data.entries.map((e) => [e.student.id, e.status ?? DEFAULT_STATUS] as const),
      ),
    );
  };

  // ── UI states ────────────────────────────────────────────────────────────────
  if (sectionsQuery.isLoading) return <LoadingState variant="page" label="Loading classes" />;
  if (sectionsQuery.isError) {
    return <ErrorState onRetry={() => void sectionsQuery.refetch()} />;
  }
  if (sectionsQuery.data && sectionsQuery.data.items.length === 0) {
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
            ? `${registerQuery.data.section.name} · ${entries.length} students`
            : 'Per-day homeroom register'
        }
      />

      <AttendanceToolbar
        sections={sectionsQuery.data?.items ?? []}
        sectionId={sectionId}
        onSectionChange={handleChangeSection}
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
                All present by default.
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
                          value={draft[entry.student.id] ?? DEFAULT_STATUS}
                          onChange={(status) => setStatus(entry.student.id, status)}
                          disabled={!canRecord || saveMut.isPending}
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

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Stack,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusBadge,
  ConfirmDialog,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import {
  useEvents,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from './hooks/useEvents';
import { MonthCalendar } from './components/MonthCalendar';
import { EventFormDialog } from './components/EventFormDialog';
import { EventDetailDialog } from './components/EventDetailDialog';
import {
  CATEGORY_META,
  CATEGORY_OPTIONS,
  VISIBILITY_META,
  addMonths,
  formatEventWhen,
  monthLabel,
  parseYMD,
  upcomingEvents,
} from './utils';
import type { CalendarEvent, EventWritePayload } from './types';

/**
 * Calendar — a shared school events board. Every role sees the same month grid and
 * upcoming list; principal & secretary can add, edit and delete events (server-enforced).
 * The visible month is seeded from the server `reference_date` so the demo opens onto
 * the populated month rather than the browser's real "today".
 */
export function CalendarPage() {
  const { user } = useAuth();
  const canManage = user ? canWrite(user.role, 'calendar') : false;

  const query = useEvents();
  const events = useMemo(() => query.data?.items ?? [], [query.data]);
  const referenceDate = query.data?.reference_date ?? '';

  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent();
  const deleteMut = useDeleteEvent();

  // Visible month; seeded from reference_date on first load, then user-controlled.
  const [cursor, setCursor] = useState<{ year: number; monthIndex: number } | null>(null);
  useEffect(() => {
    if (!cursor && referenceDate) {
      const d = parseYMD(referenceDate);
      setCursor({ year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() });
    }
  }, [cursor, referenceDate]);

  // Detail dialog
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [formDate, setFormDate] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = (date?: string) => {
    setEditing(null);
    setFormDate(date ?? referenceDate ?? null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };
  const openEdit = (event: CalendarEvent) => {
    setEditing(event);
    setFormDate(null);
    setFormError(null);
    setFormFieldErrors({});
    setDetailOpen(false);
    setFormOpen(true);
  };
  const openDetail = (event: CalendarEvent) => {
    setSelected(event);
    setDetailOpen(true);
  };

  const handleSubmit = (payload: EventWritePayload) => {
    setFormError(null);
    setFormFieldErrors({});
    const onError = (err: unknown) => {
      setFormError(apiErrorMessage(err));
      const fields = fieldErrorsFrom(err);
      if (fields) setFormFieldErrors(fields);
    };
    if (editing) {
      updateMut.mutate(
        { id: editing.id, payload },
        { onSuccess: () => setFormOpen(false), onError },
      );
    } else {
      createMut.mutate(payload, { onSuccess: () => setFormOpen(false), onError });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        setSelected(null);
      },
      onError: (err) => setDeleteError(apiErrorMessage(err)),
    });
  };

  const goToday = () => {
    const d = parseYMD(referenceDate);
    setCursor({ year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() });
  };
  const step = (delta: number) =>
    setCursor((prev) => (prev ? addMonths(prev.year, prev.monthIndex, delta) : prev));

  if (query.isLoading || !cursor) {
    return (
      <>
        <PageHeader title="Calendar" subtitle="School events and important dates." />
        <LoadingState variant="page" label="Loading calendar" />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Calendar" subtitle="School events and important dates." />
        <ErrorState onRetry={() => void query.refetch()} />
      </>
    );
  }

  const upcoming = upcomingEvents(events, referenceDate, 6);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={
          canManage
            ? 'School events and important dates. Add and manage events for the whole school.'
            : 'School events and important dates.'
        }
        primaryAction={
          canManage ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate()}>
              Add event
            </Button>
          ) : undefined
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
          alignItems: 'start',
        }}
      >
        {/* Calendar */}
        <Card variant="outlined">
          <CardContent>
            {/* Month navigation */}
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
            >
              <Typography variant="h5" component="h2">
                {monthLabel(cursor.year, cursor.monthIndex)}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Button size="small" onClick={goToday}>
                  Today
                </Button>
                <IconButton size="small" aria-label="Previous month" onClick={() => step(-1)}>
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton size="small" aria-label="Next month" onClick={() => step(1)}>
                  <ChevronRightIcon />
                </IconButton>
              </Stack>
            </Stack>

            {/* Category legend */}
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
              {CATEGORY_OPTIONS.map((c) => (
                <Stack key={c} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: `${CATEGORY_META[c].color}.main`,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {CATEGORY_META[c].label}
                  </Typography>
                </Stack>
              ))}
            </Stack>

            <MonthCalendar
              year={cursor.year}
              monthIndex={cursor.monthIndex}
              events={events}
              referenceDate={referenceDate}
              canManage={canManage}
              onSelectEvent={openDetail}
              onAddOnDay={(ymd) => openCreate(ymd)}
            />
          </CardContent>
        </Card>

        {/* Upcoming events */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h5" component="h2" gutterBottom>
              Upcoming
            </Typography>
            {upcoming.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                description="Upcoming events will appear here."
                variant="card"
              />
            ) : (
              <List disablePadding>
                {upcoming.map((e, i) => (
                  <Box key={e.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItemButton onClick={() => openDetail(e)} sx={{ px: 0, py: 1.25 }}>
                      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          <StatusBadge
                            label={CATEGORY_META[e.category].label}
                            kind={CATEGORY_META[e.category].kind}
                          />
                          {e.visibility === 'internal' && (
                            <StatusBadge label={VISIBILITY_META.internal.label} kind="neutral" />
                          )}
                        </Stack>
                        <Typography variant="subtitle2" component="p" noWrap>
                          {e.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatEventWhen(e)}
                        </Typography>
                      </Stack>
                    </ListItemButton>
                  </Box>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Box>

      <EventFormDialog
        open={formOpen}
        event={editing}
        initialDate={formDate}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      <EventDetailDialog
        open={detailOpen}
        event={selected}
        canManage={canManage}
        onEdit={() => selected && openEdit(selected)}
        onDelete={() => {
          if (selected) {
            setDeleteError(null);
            setDeleteTarget(selected);
            setDetailOpen(false);
          }
        }}
        onClose={() => setDetailOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete event?"
        destructive
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.title}"? This removes it from everyone's calendar.`
            : undefined
        }
        confirmLabel="Delete"
        pending={deleteMut.isPending}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default CalendarPage;

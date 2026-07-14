import { useMemo, useState } from 'react';
import {
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TablePagination,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ConfirmDialog,
} from '@shared/components';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { apiErrorMessage, fieldErrorsFrom } from '@shared/api/errorMessages';
import { AUDIENCE_LABEL } from './presentation';
import {
  useAnnouncementsList,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  useMarkRead,
  useAnnouncementDetail,
} from './hooks/useAnnouncements';
import { AnnouncementFeedItem } from './components/AnnouncementFeedItem';
import { AnnouncementDetailDialog } from './components/AnnouncementDetailDialog';
import { AnnouncementFormDialog } from './components/AnnouncementFormDialog';
import type {
  AnnouncementAudience,
  AnnouncementListItem,
  AnnouncementWritePayload,
  ReadFilter,
} from './types';

/**
 * Announcements feed (api-spec §5 Module 9, UI §7.9). The single screen of the module:
 *  - Targeted, newest-first feed scoped to the caller (server resolves audience).
 *  - Filter by audience + read-state (unread styled distinctly — dot + bold + border).
 *  - Click a card → opens the detail dialog AND marks it read (per-user read state).
 *  - Principal/Secretary/Teacher can compose; author or principal can edit/delete.
 *    Students are read-only (compose/edit/delete controls are hidden).
 *
 * All write-gating here is UX only; the server (MSW handler) re-checks role + ownership.
 */
const PAGE_SIZE = 10;
const ALL_AUDIENCES: AnnouncementAudience[] = ['all', 'teachers', 'students', 'class'];

export function AnnouncementsFeedScreen() {
  const { user } = useAuth();
  const canCompose = user ? canWrite(user.role, 'announcements') : false;
  const isPrincipal = user?.role === 'principal';

  // ── filter + pagination state ──────────────────────────────────────────────
  const [audience, setAudience] = useState<'' | AnnouncementAudience>('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [page, setPage] = useState(0); // 0-based for MUI TablePagination

  const params = useMemo(
    () => ({
      page: page + 1, // API is 1-based
      page_size: PAGE_SIZE,
      ...(audience ? { audience } : {}),
      ...(readFilter === 'unread' ? { unread_only: true } : {}),
    }),
    [page, audience, readFilter],
  );

  const query = useAnnouncementsList(params);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const createMut = useCreateAnnouncement();
  const updateMut = useUpdateAnnouncement();
  const deleteMut = useDeleteAnnouncement();
  const markRead = useMarkRead();

  // ── detail dialog + mark-read ────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null);

  const handleOpen = (id: string) => {
    setOpenId(id);
    const target = items.find((a) => a.id === id);
    if (target && !target.is_read) markRead.mutate(id);
  };

  // ── compose / edit form ──────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementListItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string[]>>({});

  // The form needs the full announcement (body); fetch it when editing.
  const editDetail = useAnnouncementDetail(editing?.id ?? null);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (a: AnnouncementListItem) => {
    setEditing(a);
    setFormError(null);
    setFormFieldErrors({});
    setFormOpen(true);
  };

  const handleFormSubmit = (payload: AnnouncementWritePayload) => {
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

  // ── delete confirm ─────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => setDeleteError(apiErrorMessage(err)),
    });
  };

  // Which per-row controls to show: author or principal may edit/delete (UX only).
  const canManage = (a: AnnouncementListItem): boolean =>
    isPrincipal || (user ? a.author.id === user.id : false);

  const resetPage = () => setPage(0);

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="School and class notices targeted to you."
        primaryAction={
          canCompose ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New announcement
            </Button>
          ) : undefined
        }
      />

      {/* The feed has no free-text search endpoint (audience is server-resolved), so we
          expose audience + read-state filters only rather than a dead search box. */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="filter-audience-label">Audience</InputLabel>
            <Select
              labelId="filter-audience-label"
              label="Audience"
              value={audience}
              onChange={(e: SelectChangeEvent) => {
                setAudience(e.target.value as '' | AnnouncementAudience);
                resetPage();
              }}
            >
              <MenuItem value="">All audiences</MenuItem>
              {ALL_AUDIENCES.map((a) => (
                <MenuItem key={a} value={a}>
                  {AUDIENCE_LABEL[a]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="filter-read-label">Show</InputLabel>
            <Select
              labelId="filter-read-label"
              label="Show"
              value={readFilter}
              onChange={(e: SelectChangeEvent) => {
                setReadFilter(e.target.value as ReadFilter);
                resetPage();
              }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="unread">Unread only</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <LoadingState variant="cards" rows={4} label="Loading announcements" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CampaignOutlinedIcon fontSize="inherit" />}
          title={
            readFilter === 'unread' || audience
              ? 'No announcements match your filters'
              : 'No announcements yet'
          }
          description={
            canCompose && !audience && readFilter === 'all'
              ? 'Post your first announcement to keep everyone informed.'
              : "You're all caught up."
          }
          action={
            canCompose && !audience && readFilter === 'all'
              ? { label: 'New announcement', onClick: openCreate }
              : undefined
          }
          variant="page"
        />
      ) : (
        <Stack spacing={1.5}>
          {items.map((a) => (
            <AnnouncementFeedItem
              key={a.id}
              announcement={a}
              onOpen={handleOpen}
              onEdit={canManage(a) ? openEdit : undefined}
              onDelete={
                canManage(a)
                  ? (row) => {
                      setDeleteError(null);
                      setDeleteTarget(row);
                    }
                  : undefined
              }
            />
          ))}
        </Stack>
      )}

      {total > PAGE_SIZE && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
        />
      )}

      <AnnouncementDetailDialog id={openId} onClose={() => setOpenId(null)} />

      <AnnouncementFormDialog
        open={formOpen}
        announcement={editing ? (editDetail.data ?? null) : null}
        role={user?.role ?? 'student'}
        submitting={createMut.isPending || updateMut.isPending}
        error={formError}
        fieldErrors={formFieldErrors}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete announcement?"
        destructive
        description={
          deleteTarget
            ? `Delete "${deleteTarget.title}"? Recipients will no longer see it.`
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

export default AnnouncementsFeedScreen;

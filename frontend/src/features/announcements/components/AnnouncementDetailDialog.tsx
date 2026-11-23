import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { LoadingState, ErrorState, StatusBadge } from '@shared/components';
import { AUDIENCE_KIND, AUDIENCE_LABEL, formatDateTime } from '../presentation';
import { useAnnouncementDetail } from '../hooks/useAnnouncements';

/**
 * Read-only detail view (design-system §5 dialog). Fetches the full body by id; the
 * feed only carries a preview. Marking-read is triggered by the caller when the dialog
 * opens (not here) so this component stays a pure reader. Handles loading + error +
 * the not-found (404) case the query surfaces.
 */
export interface AnnouncementDetailDialogProps {
  /** The announcement id to show; null keeps the dialog closed. */
  id: string | null;
  onClose: () => void;
}

export function AnnouncementDetailDialog({ id, onClose }: AnnouncementDetailDialogProps) {
  const query = useAnnouncementDetail(id);
  const a = query.data;

  return (
    <Dialog open={Boolean(id)} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="announcement-detail-title">
      {query.isLoading ? (
        <DialogContent>
          <LoadingState variant="form" rows={4} label="Loading announcement" />
        </DialogContent>
      ) : query.isError || !a ? (
        <DialogContent>
          <ErrorState
            title="Couldn't open this announcement"
            message="It may have been removed or is no longer available to you."
            onRetry={() => void query.refetch()}
          />
        </DialogContent>
      ) : (
        <>
          <DialogTitle id="announcement-detail-title" sx={{ pr: 6 }}>
            {a.title}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge
                  label={
                    a.audience === 'class' && a.offering
                      ? `Course · ${a.offering.label}`
                      : AUDIENCE_LABEL[a.audience]
                  }
                  kind={AUDIENCE_KIND[a.audience]}
                />
                <Typography variant="caption" color="text.secondary">
                  {a.author.full_name}
                </Typography>
              </Stack>

              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {a.body}
              </Typography>

              <Box>
                <Typography variant="caption" color="text.secondary" component="p">
                  Published {formatDateTime(a.published_at)}
                </Typography>
                {a.expires_at && (
                  <Typography variant="caption" color="text.secondary" component="p">
                    Expires {formatDateTime(a.expires_at)}
                  </Typography>
                )}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} variant="contained">
              Close
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

export default AnnouncementDetailDialog;

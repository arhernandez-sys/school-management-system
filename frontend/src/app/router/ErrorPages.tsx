import { Box, Button, Stack, Typography } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@shared/constants/routes';
import { strings } from '@i18n/strings';

function ErrorScreen({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Stack spacing={2} alignItems="center" textAlign="center">
        <Box sx={{ fontSize: 64, lineHeight: 0, color: 'text.disabled' }} aria-hidden>
          {icon}
        </Box>
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        <Typography color="text.secondary">{body}</Typography>
        <Button variant="contained" onClick={() => navigate(ROUTES.dashboard)}>
          {strings.errors.backToDashboard}
        </Button>
      </Stack>
    </Box>
  );
}

/** 403 — role/permission denial for navigation (interaction §10.3). */
export function ForbiddenPage() {
  return (
    <ErrorScreen
      icon={<BlockIcon fontSize="inherit" />}
      title={strings.errors.forbiddenTitle}
      body={strings.errors.forbiddenBody}
    />
  );
}

/** 404 — unmatched route. */
export function NotFoundPage() {
  return (
    <ErrorScreen
      icon={<SearchOffIcon fontSize="inherit" />}
      title={strings.errors.notFoundTitle}
      body={strings.errors.notFoundBody}
    />
  );
}

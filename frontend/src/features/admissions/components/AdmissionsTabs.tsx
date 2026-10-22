import { Tab, Tabs } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@shared/constants/routes';

/**
 * The two admissions lists, as tabs (D38).
 *
 * **Why a tab and not another value in the Status filter.** A pending form is not an
 * application: it lives in `application_temp`, it is visible only to whoever filed it
 * (and to the Dean), and it has no admission status to filter on. Folding it into the
 * Status dropdown would put rows from two tables with two different visibility rules behind
 * one control, and "why can my colleague not see this one?" would have no answer on screen.
 *
 * The counter is on the Pending tab rather than on Applications because unfinished work is
 * the thing you forget you have. A submitted application is already in someone's queue.
 */
export interface AdmissionsTabsProps {
  /** Which list is showing. */
  value: 'applications' | 'pending';
  /** Pending row count, when it is known. Rendered beside the label. */
  pendingCount?: number;
}

export function AdmissionsTabs({ value, pendingCount }: AdmissionsTabsProps) {
  const navigate = useNavigate();

  return (
    <Tabs
      value={value}
      onChange={(_, next: AdmissionsTabsProps['value']) =>
        navigate(next === 'pending' ? `${ROUTES.applications}/pending` : ROUTES.applications)
      }
      sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      aria-label="Admissions lists"
    >
      <Tab value="applications" label="Applications" />
      <Tab
        value="pending"
        label={
          // `undefined` rather than 0 while the count is unknown — "Pending forms (0)" on a
          // list that has simply not loaded reads as "you have none", which is a lie.
          pendingCount === undefined ? 'Pending forms' : `Pending forms (${pendingCount})`
        }
      />
    </Tabs>
  );
}

export default AdmissionsTabs;

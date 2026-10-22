import { Navigate, Route, Routes } from 'react-router-dom';
import { ApplicationReviewScreen } from './screens/ApplicationReviewScreen';
import { ApplicationWizardScreen } from './screens/ApplicationWizardScreen';
import { ApplicationsListScreen } from './screens/ApplicationsListScreen';
import { PendingApplicationsScreen } from './screens/PendingApplicationsScreen';

/**
 * Admissions routes (D30 §D11, D38) — mounted at `/applications/*`.
 *
 * `new`, `pending/:pendingId/edit` and `:applicationId/edit` are the SAME wizard component
 * in its three modes; see its own note for what each one writes. D38 removed the mid-flow
 * URL rewrite: with no save before the last step, `/new` has nothing to hand over to an
 * `:id/edit` URL and simply stays put.
 *
 * **`new` and `pending` are declared BEFORE `:applicationId`**, or React Router matches
 * either literal as an application id. `pending/:pendingId/edit` is likewise above
 * `:applicationId/edit` for the same reason.
 */
export function AdmissionsPage() {
  return (
    <Routes>
      <Route index element={<ApplicationsListScreen />} />
      <Route path="new" element={<ApplicationWizardScreen />} />
      <Route path="pending" element={<PendingApplicationsScreen />} />
      <Route path="pending/:pendingId/edit" element={<ApplicationWizardScreen />} />
      <Route path=":applicationId/edit" element={<ApplicationWizardScreen />} />
      <Route path=":applicationId" element={<ApplicationReviewScreen />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export default AdmissionsPage;

import { Navigate, Route, Routes } from 'react-router-dom';
import { ApplicationReviewScreen } from './screens/ApplicationReviewScreen';
import { ApplicationWizardScreen } from './screens/ApplicationWizardScreen';
import { ApplicationsListScreen } from './screens/ApplicationsListScreen';

/**
 * Admissions routes (D30 §D11) — mounted at `/applications/*`.
 *
 * `new` and `:id/edit` are the SAME wizard component. Step A on `/new` files the draft and
 * then `replace`s the URL with `:id/edit`, so the two are one flow with one implementation
 * — and Back never lands on an empty form that would file a second draft.
 *
 * `new` is declared BEFORE `:applicationId`, or React Router would match "new" as an id.
 */
export function AdmissionsPage() {
  return (
    <Routes>
      <Route index element={<ApplicationsListScreen />} />
      <Route path="new" element={<ApplicationWizardScreen />} />
      <Route path=":applicationId/edit" element={<ApplicationWizardScreen />} />
      <Route path=":applicationId" element={<ApplicationReviewScreen />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export default AdmissionsPage;

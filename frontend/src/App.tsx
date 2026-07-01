import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@app/providers/AppProviders';
import { router } from '@app/router/routes';

/**
 * Top-level app: providers wrap the data router. The router owns layout (AppShell)
 * and the route outlet, so App.tsx stays thin (architecture §5).
 */
export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

export default App;

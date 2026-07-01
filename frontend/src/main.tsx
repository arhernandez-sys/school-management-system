import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startMocks } from '@shared/api/mocks/browser';

/**
 * App bootstrap (architecture §5). Starts the dev-only MSW mock layer (no-op unless
 * VITE_ENABLE_MOCKS=true) BEFORE rendering, so the AuthProvider's bootstrap refresh
 * is intercepted in mock mode. With mocks off, the SPA talks to the real backend.
 */
async function bootstrap(): Promise<void> {
  await startMocks();

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root not found');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

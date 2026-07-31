import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/**
 * App bootstrap (architecture §5).
 *
 * ⚠️ THE MOCK LAYER IS IMPORTED DYNAMICALLY, AND THAT IS LOAD-BEARING — do not
 * hoist it back to a static `import`.
 *
 * `startMocks` pulls in the MSW runtime, every mock handler, and the whole demo
 * dataset (a fictional school: 45 students, 12 teachers, ~1,200 grades). With a
 * static import that entire graph was linked into the production bundle and
 * shipped to real users — confirmed by grepping the built `dist/` for demo-only
 * strings — kept dormant only by a runtime flag. For a student-records system on a
 * public URL that is the wrong posture: dead code that can serve fabricated
 * student data is one misread env var away from doing so.
 *
 * `import.meta.env.VITE_ENABLE_MOCKS` is substituted with a literal at build time,
 * so with mocks off this condition folds to `false` and Rollup drops the branch —
 * and with it MSW, the handlers and the dataset — out of the bundle entirely. In
 * demo mode (`npm run demo`) the same code loads it as a separate chunk. Awaiting
 * it before render preserves the original guarantee that the AuthProvider's
 * bootstrap refresh is intercepted in mock mode.
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MOCKS === 'true') {
    const { startMocks } = await import('@shared/api/mocks/browser');
    await startMocks();
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element #root not found');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

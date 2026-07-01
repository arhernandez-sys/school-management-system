import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** MSW browser worker (dev-only). Started conditionally in main.tsx. */
export const worker = setupWorker(...handlers);

/**
 * Start the mock service worker when VITE_ENABLE_MOCKS === 'true'. No-op otherwise.
 * Returns a promise that resolves once interception is ready (so the app waits).
 */
export async function startMocks(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'true') return;
  await worker.start({
    onUnhandledRequest: 'bypass', // let non-mocked requests hit the network/backend
  });
  // eslint-disable-next-line no-console
  console.info('[MSW] Dev mock layer active (auth fixtures). Disable via VITE_ENABLE_MOCKS=false.');
}

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers/index';

/** MSW browser worker (dev/demo-only). Started conditionally in main.tsx. */
export const worker = setupWorker(...handlers);

/**
 * Re-register THIS page as an active MSW client by re-sending the `MOCK_ACTIVATE`
 * message the worker uses to populate its in-memory `activeClientIds` set.
 *
 * WHY THIS IS NEEDED (fixes the intermittent "list breaks → Retry, refresh fixes it"):
 * the generated `mockServiceWorker.js` keeps `activeClientIds` in module scope and its
 * fetch handler early-returns (passes the request through UNMOCKED) whenever that set is
 * empty. The browser TERMINATES an idle service worker after ~30s; MSW pings it every 5s
 * to keep it warm, but browsers throttle timers to >=60s in BACKGROUNDED tabs — so a demo
 * tab left in the background (or through a machine sleep) long enough outlives its worker,
 * and the restarted worker comes back with an EMPTY `activeClientIds`. Every `/api/v1/*`
 * call then bypasses the worker; with no backend behind the demo it 404s on the dev server
 * and the screen shows "Retry" until a full reload re-runs the activation handshake.
 *
 * Re-posting `MOCK_ACTIVATE` when the tab returns to the foreground restores interception
 * without that manual refresh. We post it directly to the worker because `worker.start()`
 * short-circuits once mocking is already "enabled" on the client and would NOT re-send it.
 */
function reactivateMocking(): void {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) return;
  if (sw.controller) {
    sw.controller.postMessage('MOCK_ACTIVATE');
  } else {
    // Not currently controlled (worker still activating) — reach it via the registration.
    void sw.ready.then((reg) => reg.active?.postMessage('MOCK_ACTIVATE')).catch(() => undefined);
  }
}

let reactivationBound = false;
/** Bind the foreground/back-forward listeners exactly once. */
function bindReactivation(): void {
  if (reactivationBound || typeof document === 'undefined') return;
  reactivationBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reactivateMocking();
  });
  // bfcache restores (back/forward) don't always fire visibilitychange.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reactivateMocking();
  });
}

/**
 * Start the mock service worker when VITE_ENABLE_MOCKS === 'true'. No-op otherwise.
 * Returns a promise that resolves once interception is ready (so the app waits).
 *
 * In DEMO mode (`npm run demo`, .env.demo sets VITE_ENABLE_MOCKS=true) this serves the
 * whole app from the in-memory demo dataset — no backend, no database.
 */
export async function startMocks(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'true') return;
  await worker.start({
    onUnhandledRequest: 'bypass', // let non-mocked requests hit the network/backend
  });
  // Keep interception alive across idle service-worker termination (see reactivateMocking).
  bindReactivation();
  // eslint-disable-next-line no-console
  console.info('[MSW] Mock layer active (demo dataset). Disable via VITE_ENABLE_MOCKS=false.');
}

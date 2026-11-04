import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Delete `mockServiceWorker.js` from the build output unless mocks are enabled.
 *
 * The worker script lives in `public/`, which Vite copies verbatim — it is not part
 * of the module graph, so tree-shaking cannot reach it and the file shipped with
 * every production build. A stray service worker on a public origin is a script
 * that, once registered, can intercept and answer EVERY request the page makes.
 * Nothing in a mocks-off bundle registers it (see `src/main.tsx`), so it was inert
 * — but shipping an inert request interceptor to a student-records site is a
 * needless foothold, and removing it costs nothing.
 *
 * Runs in `closeBundle`, after the public-dir copy. `force: true` so a build with no
 * worker present (a fresh clone that never ran `msw init`) is not an error.
 */
function stripMockWorker(enableMocks: boolean): Plugin {
  let outDir = 'dist';
  return {
    name: 'sis-strip-mock-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      if (enableMocks) return;
      await rm(path.resolve(process.cwd(), outDir, 'mockServiceWorker.js'), { force: true });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third arg '' loads ALL vars, not just the VITE_-prefixed ones.
  const env = loadEnv(mode, process.cwd(), '');
  const enableMocks = env.VITE_ENABLE_MOCKS === 'true';

  return {
    plugins: [react(), stripMockWorker(enableMocks)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
        '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@theme': fileURLToPath(new URL('./src/theme', import.meta.url)),
        '@i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // ── Local dev API proxy (7.0e / OQ-FE-A) ──────────────────────────────────
      // In local dev the backend (ENVIRONMENT=local) sets the HttpOnly `sis_refresh`
      // cookie as SameSite=Lax (a SameSite=None cookie is rejected by browsers without
      // Secure, and local http has no TLS). A Lax cookie is NOT sent on a *cross-site*
      // XHR — so if the SPA (:5173) called the API (:8000) directly, the silent refresh
      // on hard reload would never receive the cookie.
      //
      // Proxying `/api/v1/*` through the Vite dev server makes those calls SAME-ORIGIN
      // (both appear as :5173), so the Lax cookie rides along and silent refresh works
      // over plain http. Set `VITE_API_BASE_URL=/api/v1` (relative) in `.env` to use it.
      //
      // IN PRODUCTION, serve the SPA and the API from the SAME ORIGIN (one reverse
      // proxy: `/` → static files, `/api/v1` → uvicorn). That keeps the refresh cookie
      // same-site and is the deployment shape RUNBOOK §10 documents. A cross-origin
      // split forces SameSite=None, which needs TLS on both origins plus an exact CORS
      // allow-list — more moving parts, no benefit for a single-school deployment.
      proxy: {
        '/api/v1': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Readable chunk filenames. Every feature module is `index.tsx`, so Rollup's
          // default naming produced 11 indistinguishable `index-<hash>.js` files — which
          // made the role-scoping claim unverifiable in practice. Now you can open
          // DevTools → Network as a student and see for yourself that no
          // `feature-students` / `feature-settings` / `feature-reports` chunk is ever
          // requested. Purely cosmetic: this changes names, never chunk composition.
          chunkFileNames(chunkInfo) {
            const id = chunkInfo.facadeModuleId ?? '';
            const feature = /[\\/]features[\\/]([^\\/]+)[\\/]/.exec(id)?.[1];
            if (!feature) return 'assets/[name]-[hash].js';
            const base = /([^\\/]+)\.[jt]sx?$/.exec(id)?.[1] ?? '';
            // `features/grades/index.tsx` → feature-grades; a deeper split point like
            // `features/students/MyStudentProfilePage.tsx` keeps its own name so the two
            // do not look like the same chunk.
            return base === 'index'
              ? `assets/feature-${feature}-[hash].js`
              : `assets/feature-${feature}-${base}-[hash].js`;
          },
          // Vendor libs split out of the app chunk. Route-level code-splitting for the
          // feature modules is done with React.lazy in `src/app/router/routes.tsx`, so
          // each role downloads only the screens it can reach.
          //
          // These vendor chunks are still fetched ON DEMAND: a chunk is only requested
          // when a loaded chunk imports it. `charts` (recharts, the largest) is pulled
          // in by the screens that actually render charts, not by every first load.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
            query: ['@tanstack/react-query'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});

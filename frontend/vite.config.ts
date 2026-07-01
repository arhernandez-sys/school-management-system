import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    // In production the SPA (Vercel) and API (Railway) ARE cross-origin → the backend
    // must set SameSite=None; Secure over HTTPS (it already does outside `local`).
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
        // Split heavy vendor libs out of the app chunk. Phase 7 adds route-level
        // code-splitting (React.lazy) for the 11 feature modules.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});

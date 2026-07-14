import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setOnRefreshFailure } from '@shared/api/client';
import { queryClient } from '@app/providers/queryClient';
import type { CurrentUser } from '@shared/types/api';
import {
  bootstrapSession,
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
} from '../api/authApi';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';

/**
 * AuthProvider — owns the in-memory access token (via the HTTP client) + the
 * current user/role (architecture §3.1, §7.2).
 *
 * On mount it performs the BOOTSTRAP SILENT REFRESH: it attempts /auth/refresh
 * before any route guard renders, so a hard reload doesn't bounce an authenticated
 * user to /login. Guards read `status === 'bootstrapping'` and show a loading state
 * until this resolves to 'authenticated' or 'anonymous'.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<CurrentUser | null>(null);

  // Guard against double-bootstrap in React 18 StrictMode dev double-invoke.
  const bootstrapped = useRef(false);

  useEffect(() => {
    // The `bootstrapped` ref guarantees the silent refresh runs exactly once, even
    // under React 18 StrictMode's double-invoke. We intentionally do NOT use an
    // `active`/cleanup flag here: StrictMode's simulated unmount would flip it false
    // and, because the ref guard blocks the re-mounted effect from re-running, the
    // in-flight bootstrap would then resolve into a no-op and strand `status` at
    // 'bootstrapping' forever (stuck on "Restoring your session…"). Setting state
    // after a real unmount is a harmless no-op in React 18.
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void bootstrapSession().then((currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    });
  }, []);

  // When the HTTP client's single-flight refresh definitively fails mid-session,
  // drop to anonymous so guards redirect to /login (interaction §10.3).
  useEffect(() => {
    setOnRefreshFailure(() => {
      setUser(null);
      setStatus('anonymous');
      // Drop every cached query so a re-login (possibly as a different role) never
      // reads the previous session's data. See the note on logout() below.
      queryClient.clear();
    });
    return () => setOnRefreshFailure(null);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    // Start the new session from an empty cache: most feature queries are keyed by
    // resource (e.g. ['sections','options'], student/teacher lists) rather than by
    // user, so without this a role switch would serve the prior user's still-"fresh"
    // data (staleTime 30–60s) with no refetch — the bug where the app only showed the
    // right data after a manual page reload (which wiped the in-memory cache).
    queryClient.clear();
    const { user: loggedIn } = await loginRequest({ identifier, password });
    setUser(loggedIn);
    setStatus('authenticated');
    return loggedIn;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus('anonymous');
    // Purge cached queries so the next user (or a re-login as a different role) starts
    // clean instead of inheriting this session's data until it happens to go stale.
    queryClient.clear();
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await fetchCurrentUser();
    setUser(fresh);
    setStatus('authenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, refreshUser }),
    [status, user, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

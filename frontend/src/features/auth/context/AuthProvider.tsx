import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setOnRefreshFailure } from '@shared/api/client';
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
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    let active = true;
    void bootstrapSession().then((currentUser) => {
      if (!active) return;
      if (currentUser) {
        setUser(currentUser);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // When the HTTP client's single-flight refresh definitively fails mid-session,
  // drop to anonymous so guards redirect to /login (interaction §10.3).
  useEffect(() => {
    setOnRefreshFailure(() => {
      setUser(null);
      setStatus('anonymous');
    });
    return () => setOnRefreshFailure(null);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const { user: loggedIn } = await loginRequest({ identifier, password });
    setUser(loggedIn);
    setStatus('authenticated');
    return loggedIn;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus('anonymous');
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

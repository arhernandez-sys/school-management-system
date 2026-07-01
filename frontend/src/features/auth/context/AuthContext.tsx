import { createContext } from 'react';
import type { CurrentUser } from '@shared/types/api';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  /** Bootstrapping = silent refresh in flight (guards show a loading state). */
  status: AuthStatus;
  user: CurrentUser | null;
  /** Authenticate with identifier + password. Throws ApiError on failure. */
  login: (identifier: string, password: string) => Promise<CurrentUser>;
  /** End the session and return to anonymous. */
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (e.g. after a password change clears must_change_password). */
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

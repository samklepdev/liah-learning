import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authApi, type User } from './api';
import { AuthContext, type AuthState } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // The cookie is httpOnly, so JS can't read it. "Am I logged in?" is always a
  // round-trip, which is why `loading` exists — without it the login screen
  // flashes on every refresh for an already-authenticated user.
  useEffect(() => {
    let cancelled = false;

    authApi
      .me()
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch((err: unknown) => {
        // 401 just means "not logged in" — anything else is worth surfacing.
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.login(email, password);
    setUser(user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.register(email, password);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { PublicUser } from '@/types';
import {
  restoreSession,
  login as authLogin,
  logout as authLogout,
  subscribeAuth,
  LoginResult,
} from '@/lib/auth';

interface AuthState {
  user: PublicUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]         = useState<PublicUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  // On mount — try to restore session from httpOnly refresh cookie
  useEffect(() => {
    restoreSession().then((u) => {
      setUser(u);
      setLoading(false);
    });

    // Subscribe to auth state changes (e.g. auto-refresh, logout)
    const unsub = subscribeAuth((u) => setUser(u));
    return unsub;
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const result = await authLogin(username, password);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

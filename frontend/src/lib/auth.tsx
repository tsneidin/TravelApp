import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, clearToken, setToken } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const r = await apiGet<{ user: User }>('/auth/me');
      setUser(r.user);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!localStorage.getItem('travelapp_token')) {
      setLoading(false);
      return;
    }
    apiGet<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await apiPost<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
  };

  const register = async (email: string, name: string, password: string) => {
    const r = await apiPost<{ token: string; user: User }>('/auth/register', { email, name, password });
    setToken(r.token);
    setUser(r.user);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
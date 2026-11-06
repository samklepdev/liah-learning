import { createContext } from 'react';
import type { User } from './api';

export type AuthState = {
  user: User | null;
  /** True until the initial /auth/me check settles. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (firstName: string, lastName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
};

export const AuthContext = createContext<AuthState | null>(null);

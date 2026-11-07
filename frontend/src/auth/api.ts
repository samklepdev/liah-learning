import { ApiError, request } from '../lib/apiClient';
export { ApiError, request };

export type User = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  mustChangePassword: boolean;
  createdAt: string;
};

/**
 * Mirrors the `credentials` schema in
 * backend/src/controllers/auth.controller.ts — keep the two in step, or the
 * form rejects passwords the API would accept.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const authApi = {
  me: () => request<{ user: User }>('/auth/me'),

  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (firstName: string, lastName: string, password: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, password }),
    }),

  forgotPassword: (username: string) =>
    request<void>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};

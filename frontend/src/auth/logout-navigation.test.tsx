import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './AuthProvider';
import { AppRouter } from '../router';

vi.mock('./api', () => ({
  authApi: {
    me: () =>
      Promise.resolve({
        user: { id: 'u1', username: 'absmith', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
      }),
    logout: () => Promise.resolve(undefined),
    login: vi.fn(),
    register: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  MIN_PASSWORD_LENGTH: 8,
}));

describe('signing out', () => {
  test('leaves the page you signed out from, landing on "/"', async () => {
    window.history.pushState({}, '', '/profile');
    render(
      <AuthProvider>
        <AppRouter />
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: 'Profile' });

    await userEvent.click(screen.getByRole('button', { name: /absmith/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
  });

  test('leaves "/subjects" itself, landing on "/" rather than staying put', async () => {
    window.history.pushState({}, '', '/subjects');
    render(
      <AuthProvider>
        <AppRouter />
      </AuthProvider>,
    );

    await screen.findByRole('navigation', { name: 'Subjects' });

    await userEvent.click(screen.getByRole('button', { name: /absmith/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
  });
});

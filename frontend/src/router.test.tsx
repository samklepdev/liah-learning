import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppRouter } from './router';

const useAuth = vi.fn();

vi.mock('./auth/useAuth', () => ({ useAuth: () => useAuth() }));

function at(path: string) {
  window.history.pushState({}, '', path);
  return render(<AppRouter />);
}

beforeEach(() => {
  useAuth.mockReturnValue({
    user: { id: 'u1', username: 'absmith', role: 'user', mustChangePassword: false, createdAt: '2026-11-02T12:00:00.000Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
  });
});

describe('AppRouter', () => {
  test('an unmatched path renders the 404 page', () => {
    at('/no/such/page');
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  test('a 404 shows even when signed out, rather than a login form', () => {
    // A mistyped URL should say so. Bouncing to login would imply the page
    // exists and you merely lack access.
    useAuth.mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    at('/no/such/page');

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sign in to your account' }),
    ).not.toBeInTheDocument();
  });

  test('a real route signed out still asks for sign-in', () => {
    useAuth.mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    at('/courses');

    expect(screen.getByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });

  test('a non-admin hitting /admin/users sees the 404 page, not the users table', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', username: 'absmith', role: 'user', mustChangePassword: false, createdAt: '2026-11-02T12:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    });

    at('/admin/users');

    expect(screen.getByText('404')).toBeInTheDocument();
  });

  test('a user with mustChangePassword sees the forced password form, not the requested page', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', username: 'new.user', role: 'user', mustChangePassword: true, createdAt: '2026-11-06T00:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    });

    at('/subjects');

    expect(screen.getByText('Set your password')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });

  test('a user with mustChangePassword hitting /admin/users still sees the forced form, not the users table', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', username: 'admin.new', role: 'admin', mustChangePassword: true, createdAt: '2026-11-06T00:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    });

    at('/admin/users');

    expect(screen.getByText('Set your password')).toBeInTheDocument();
  });
});

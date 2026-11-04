import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RequireAdmin } from './router';

const useAuth = vi.fn();
vi.mock('./auth/useAuth', () => ({ useAuth: () => useAuth() }));

function renderGuard() {
  return render(
    <MemoryRouter>
      <RequireAdmin>
        <div>admin content</div>
      </RequireAdmin>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  test('renders children for an admin', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'admin' }, loading: false });
    renderGuard();
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  test('renders the 404 page for a signed-in non-admin', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'user' }, loading: false });
    renderGuard();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  test('renders the 404 page when signed out', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderGuard();
    expect(screen.getByText('404')).toBeInTheDocument();
  });
});

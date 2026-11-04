import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminUsersPage } from './AdminUsersPage';

const listUsers = vi.fn();
const setRole = vi.fn();
const deleteUser = vi.fn();
const getUserAttempts = vi.fn();
const useAuth = vi.fn();

vi.mock('../../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../../admin/api', () => ({
  adminApi: {
    listUsers: () => listUsers(),
    setRole: (id: string, role: string) => setRole(id, role),
    deleteUser: (id: string) => deleteUser(id),
    getUserAttempts: (id: string) => getUserAttempts(id),
  },
}));

beforeEach(() => {
  useAuth.mockReturnValue({ user: { id: 'me', email: 'admin@example.com', role: 'admin' } });
  listUsers.mockResolvedValue({
    users: [
      { id: 'me', email: 'admin@example.com', role: 'admin', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'u2', email: 'student@example.com', role: 'user', createdAt: '2026-11-02T00:00:00Z' },
    ],
  });
  getUserAttempts.mockResolvedValue({ attempts: [] });
  setRole.mockResolvedValue({ user: { id: 'u2', email: 'student@example.com', role: 'admin' } });
  deleteUser.mockResolvedValue(undefined);
});

describe('AdminUsersPage', () => {
  test('lists every user with their role', async () => {
    render(<AdminUsersPage />);
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
  });

  test("disables promote/demote and delete for the signed-in admin's own row", async () => {
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');
    const ownRow = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(ownRow).getByRole('button', { name: /make user/i })).toBeDisabled();
    expect(within(ownRow).getByRole('button', { name: /delete/i })).toBeDisabled();
  });

  test('promoting a user calls setRole and reflects the new role', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /make admin/i }));

    await waitFor(() => expect(setRole).toHaveBeenCalledWith('u2', 'admin'));
  });

  test('deleting a user calls deleteUser and removes the row', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u2'));
    await waitFor(() =>
      expect(screen.queryByText('student@example.com')).not.toBeInTheDocument(),
    );
  });
});

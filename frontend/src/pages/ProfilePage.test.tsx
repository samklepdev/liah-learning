import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
const useAuth = vi.fn();

vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: { changePassword: (a: string, b: string) => changePassword(a, b) },
}));

beforeEach(() => {
  useAuth.mockReturnValue({
    user: {
      id: 'u1',
      email: 'student@example.com',
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
    },
  });
  changePassword.mockReset();
});

describe('ProfilePage', () => {
  test('shows the email, but not a Role row, for a plain user', () => {
    render(<ProfilePage />);
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  test('shows the Role row for an admin', () => {
    useAuth.mockReturnValue({
      user: {
        id: 'u2',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  test('submitting calls changePassword, shows a success message, and clears the fields', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-pass-123' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'),
    );
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  test('a rejected current password shows an error and keeps the fields filled in', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });
});

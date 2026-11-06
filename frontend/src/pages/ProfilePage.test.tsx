import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
const useAuth = vi.fn();
const toastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: {
    changePassword: (a: string, b: string) => changePassword(a, b),
  },
}));

function mockUser(
  overrides: Partial<{
    firstName: string | null;
    lastName: string | null;
    role: 'user' | 'admin';
  }> = {},
) {
  useAuth.mockReturnValue({
    user: {
      id: 'u1',
      username: 'student',
      firstName: null,
      lastName: null,
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
      ...overrides,
    },
  });
}

function openPasswordForm() {
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
}

beforeEach(() => {
  mockUser();
  changePassword.mockReset();
  toastSuccess.mockReset();
});

describe('ProfilePage', () => {
  test('shows the username and em-dash name fields, but not a Role row, for a plain user', () => {
    render(<ProfilePage />);
    expect(screen.getByText('student')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  test('shows the Role row for an admin', () => {
    mockUser({ role: 'admin' });
    render(<ProfilePage />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  test('displays the current first and last name with no way to edit them', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit profile/i })).not.toBeInTheDocument();
  });

  test('clicking Change password reveals the password form, with no name inputs anywhere', () => {
    render(<ProfilePage />);
    openPasswordForm();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
  });

  test('Cancel discards password edits and hides the form without any network calls', () => {
    render(<ProfilePage />);
    openPasswordForm();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'something' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('only one password field filled shows a validation error and does not call the API', async () => {
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(
      await screen.findByText('Enter both current and new password to change it.'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('saving with both password fields filled calls changePassword and hides the form', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass-123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Password updated.'));
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  test('a failed password change keeps the form open and shows the error', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });
});

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
const updateName = vi.fn();
const updateUser = vi.fn();
const useAuth = vi.fn();

vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: {
    changePassword: (a: string, b: string) => changePassword(a, b),
    updateName: (a: string, b: string) => updateName(a, b),
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
      email: 'student@example.com',
      firstName: null,
      lastName: null,
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
      ...overrides,
    },
    updateUser,
  });
}

function openEditMode() {
  fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
}

beforeEach(() => {
  mockUser();
  changePassword.mockReset();
  updateName.mockReset();
  updateUser.mockReset();
});

describe('ProfilePage', () => {
  test('shows the email and em-dash name fields, but not a Role row, for a plain user', () => {
    render(<ProfilePage />);
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  test('shows the Role row for an admin', () => {
    mockUser({ role: 'admin' });
    render(<ProfilePage />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  test('displays the current first and last name when set', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
  });

  test('clicking Edit profile reveals the form pre-filled with the current name', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    openEditMode();
    expect(screen.getByLabelText('First name')).toHaveValue('Jane');
    expect(screen.getByLabelText('Last name')).toHaveValue('Doe');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  test('Cancel discards edits and returns to read-only view without any network calls', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    openEditMode();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('saving with only the name changed calls updateName, not changePassword, and returns to read-only view', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'student@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Jane', 'Doe'));
    expect(changePassword).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      ),
    );
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  test('saving with both name and password filled calls both APIs and returns to read-only view', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'student@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass-123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Jane', 'Doe'));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'));
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  test('only one password field filled shows a validation error and calls neither API', async () => {
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(
      await screen.findByText('Enter both current and new password to change it, or leave both blank.'),
    ).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('a failed password change keeps edit mode open, applies the name change, and shows the password error', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'student@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      ),
    );
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });

  test('a failed name update stays in edit mode and shows the name error', async () => {
    updateName.mockRejectedValue(new Error('Something went wrong'));
    render(<ProfilePage />);
    openEditMode();

    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  test('clearing the first name and submitting calls updateName with an empty string', async () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'student@example.com',
        firstName: null,
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('', 'Doe'));
  });
});

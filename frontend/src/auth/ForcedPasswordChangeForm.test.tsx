import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForcedPasswordChangeForm } from './ForcedPasswordChangeForm';

const changePassword = vi.fn();
const updateUser = vi.fn();
const useAuth = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, authApi: { changePassword: (a: string, b: string) => changePassword(a, b) } };
});
vi.mock('./useAuth', () => ({ useAuth: () => useAuth() }));

beforeEach(() => {
  changePassword.mockReset();
  updateUser.mockReset();
  useAuth.mockReturnValue({
    user: { id: 'u1', username: 'new.user', mustChangePassword: true },
    updateUser,
  });
});

describe('ForcedPasswordChangeForm', () => {
  test('submits the temporary password as current and the new password', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'liahwellness' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('liahwellness', 'my-new-password-1'));
  });

  test('clears mustChangePassword on the user after a successful change', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'liahwellness' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', mustChangePassword: false }),
      ),
    );
  });

  test('shows an error and does not clear the flag when the API call fails', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

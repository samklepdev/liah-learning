import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PasswordRequestsPage } from './PasswordRequestsPage';

const listPasswordRequests = vi.fn();
const resetPassword = vi.fn();
const dismissPasswordRequest = vi.fn();

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listPasswordRequests: () => listPasswordRequests(),
    resetPassword: (id: string) => resetPassword(id),
    dismissPasswordRequest: (userId: string) => dismissPasswordRequest(userId),
  },
}));

beforeEach(() => {
  listPasswordRequests.mockResolvedValue({
    requests: [
      {
        userId: 'u1',
        username: 'forgetful',
        firstName: 'For',
        lastName: 'Getful',
        requestedAt: '2026-11-06T00:00:00.000Z',
      },
    ],
  });
  resetPassword.mockResolvedValue(undefined);
  dismissPasswordRequest.mockResolvedValue(undefined);
  toastSuccess.mockReset();
});

describe('PasswordRequestsPage', () => {
  test('lists pending requests', async () => {
    render(<PasswordRequestsPage />);
    expect(await screen.findByText('forgetful')).toBeInTheDocument();
  });

  test('shows an empty state with no pending requests', async () => {
    listPasswordRequests.mockResolvedValue({ requests: [] });
    render(<PasswordRequestsPage />);
    expect(await screen.findByText('No pending password reset requests.')).toBeInTheDocument();
  });

  test('resetting a request calls the API, removes the row, and toasts', async () => {
    render(<PasswordRequestsPage />);
    const row = (await screen.findByText('forgetful')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('forgetful')).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Password reset — user must set a new one at next login.');
  });

  test('dismissing a request calls the API, removes the row, and toasts', async () => {
    render(<PasswordRequestsPage />);
    const row = (await screen.findByText('forgetful')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(dismissPasswordRequest).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('forgetful')).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Request dismissed.');
  });
});

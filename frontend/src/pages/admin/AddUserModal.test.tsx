import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddUserModal } from './AddUserModal';

const createUser = vi.fn();
const toastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));
vi.mock('../../admin/api', () => ({
  adminApi: { createUser: (firstName: string, lastName: string, role: string) => createUser(firstName, lastName, role) },
}));

beforeEach(() => {
  createUser.mockReset();
  toastSuccess.mockReset();
});

describe('AddUserModal', () => {
  test('submitting calls createUser, toasts, and closes', async () => {
    createUser.mockResolvedValue({
      user: { id: 'u3', username: 'njordan', firstName: 'New', lastName: 'Jordan', role: 'user', createdAt: '2026-11-06T00:00:00Z' },
    });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserModal onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Jordan' } });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith('New', 'Jordan', 'user'));
    expect(toastSuccess).toHaveBeenCalledWith('User created. Initial password: liahwellness');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('a duplicate-name error shows inline and keeps the modal open with the form filled', async () => {
    createUser.mockRejectedValue(new Error('A user with this name already exists'));
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserModal onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Existing' } });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByText('A user with this name already exists')).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Test');
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('clicking the overlay closes the modal', () => {
    const onClose = vi.fn();
    render(<AddUserModal onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByTestId('admin-modal-overlay'));

    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the close button closes the modal', () => {
    const onClose = vi.fn();
    render(<AddUserModal onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  test('the Create user button is disabled until both names are filled', () => {
    render(<AddUserModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByRole('button', { name: /create user/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'New' } });
    expect(screen.getByRole('button', { name: /create user/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Jordan' } });
    expect(screen.getByRole('button', { name: /create user/i })).toBeEnabled();
  });
});

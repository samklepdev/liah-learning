import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from './LoginForm';

const login = vi.fn();
const register = vi.fn();
const forgotPassword = vi.fn();

vi.mock('./useAuth', () => ({
  useAuth: () => ({ login: (u: string, p: string) => login(u, p), register }),
}));

vi.mock('./api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: { forgotPassword: (username: string) => forgotPassword(username) },
}));

beforeEach(() => {
  login.mockReset();
  register.mockReset();
  forgotPassword.mockReset().mockResolvedValue(undefined);
});

describe('LoginForm forgot-password flow', () => {
  test('clicking "Forgot password?" switches to the username-only form', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('button', { name: 'Notify admin' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });

  test('carries over whatever username was already typed', () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByPlaceholderText('Username')).toHaveValue('jdoe');
  });

  test('submitting calls forgotPassword and shows a neutral confirmation', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify admin' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('jdoe'));
    expect(
      await screen.findByText('If that username exists, an admin has been notified.'),
    ).toBeInTheDocument();
  });

  test('shows the same confirmation even when the request fails', async () => {
    forgotPassword.mockRejectedValue(new Error('network error'));
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify admin' }));

    expect(
      await screen.findByText('If that username exists, an admin has been notified.'),
    ).toBeInTheDocument();
  });

  test('"Back to sign in" returns to the login form', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });
});

import { useState, type SubmitEvent } from 'react';
import liahLogo from '../assets/liah-logo.png';
import { authApi, MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

export function ForcedPasswordChangeForm() {
  const { user, updateUser } = useAuth();
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.changePassword(temporaryPassword, newPassword);
      if (user) updateUser({ ...user, mustChangePassword: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-head">
          <img src={liahLogo} alt="LIAH" className="auth-mark" />
          <h1>Set your password</h1>
          <p className="auth-subtitle">
            An admin created your account with a temporary password. Set your own password to continue.
          </p>
        </header>

        <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
          <div className="auth-fields">
            <input
              type="password"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              placeholder="Temporary password"
              aria-label="Temporary password"
              autoComplete="current-password"
              required
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>

          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Working…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-page">
      <h1>Profile</h1>

      <dl className="profile-details">
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>Role</dt>
        <dd>{user?.role}</dd>
      </dl>

      <h2>Change password</h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form profile-form">
        <div className="auth-fields">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            aria-label="Current password"
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

        <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>

        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}

        {success && <p className="profile-success">Password changed.</p>}

        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Working…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

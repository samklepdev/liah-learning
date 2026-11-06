import { useState, type SubmitEvent } from 'react';
import toast from 'react-hot-toast';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user } = useAuth();

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function startChangingPassword() {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setIsChangingPassword(true);
  }

  function cancelChangingPassword() {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setIsChangingPassword(false);
  }

  async function handleChangePassword(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError(null);

    const bothFilled = currentPassword !== '' && newPassword !== '';
    if (!bothFilled) {
      setPasswordError('Enter both current and new password to change it.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setIsChangingPassword(false);
      toast.success('Password updated.');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>

      <dl className="profile-details">
        <dt>First name</dt>
        <dd>{user?.firstName ?? '—'}</dd>
        <dt>Last name</dt>
        <dd>{user?.lastName ?? '—'}</dd>
        <dt>Username</dt>
        <dd>{user?.username}</dd>
        {user?.role === 'admin' && (
          <>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </>
        )}
      </dl>

      {!isChangingPassword && (
        <button type="button" className="auth-submit" onClick={startChangingPassword}>
          Change password
        </button>
      )}

      {isChangingPassword && (
        <form onSubmit={(e) => void handleChangePassword(e)} className="auth-form profile-form">
          <div className="auth-fields">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              aria-label="Current password"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>

          <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>

          {passwordError && (
            <p role="alert" className="auth-error">
              {passwordError}
            </p>
          )}

          <div className="profile-actions">
            <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? 'Working…' : 'Save password'}
            </button>
            <button
              type="button"
              className="auth-submit auth-submit-secondary"
              disabled={submitting}
              onClick={cancelChangingPassword}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

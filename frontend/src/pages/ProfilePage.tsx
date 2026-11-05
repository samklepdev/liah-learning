import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSubmitting, setNameSubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleNameSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setNameSuccess(false);
    setNameSubmitting(true);
    try {
      const { user: updated } = await authApi.updateName(firstName, lastName);
      updateUser(updated);
      setNameSuccess(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setNameSubmitting(false);
    }
  }

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
        {user?.role === 'admin' && (
          <>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </>
        )}
      </dl>

      <h2>Edit name</h2>
      <form onSubmit={(e) => void handleNameSubmit(e)} className="auth-form profile-form">
        <div className="auth-fields">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            aria-label="First name"
            autoComplete="given-name"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            aria-label="Last name"
            autoComplete="family-name"
          />
        </div>

        {nameError && (
          <p role="alert" className="auth-error">
            {nameError}
          </p>
        )}

        {nameSuccess && <p className="profile-success">Name updated.</p>}

        <button type="submit" className="auth-submit" disabled={nameSubmitting} aria-busy={nameSubmitting}>
          {nameSubmitting ? 'Working…' : 'Save name'}
        </button>
      </form>

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

import { useState, type SubmitEvent } from 'react';
import toast from 'react-hot-toast';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user, updateUser } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function startEditing() {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
    setCurrentPassword('');
    setNewPassword('');
    setNameError(null);
    setPasswordError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setCurrentPassword('');
    setNewPassword('');
    setNameError(null);
    setPasswordError(null);
    setIsEditing(false);
  }

  async function handleSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setPasswordError(null);

    const bothPasswordFieldsFilled = currentPassword !== '' && newPassword !== '';
    const onePasswordFieldFilled = (currentPassword !== '') !== (newPassword !== '');
    if (onePasswordFieldFilled) {
      setPasswordError('Enter both current and new password to change it, or leave both blank.');
      return;
    }

    setSubmitting(true);
    const [nameResult, passwordResult] = await Promise.allSettled([
      authApi.updateName(firstName, lastName),
      bothPasswordFieldsFilled
        ? authApi.changePassword(currentPassword, newPassword)
        : Promise.resolve(null),
    ]);
    setSubmitting(false);

    let nameOk = false;
    if (nameResult.status === 'fulfilled') {
      updateUser(nameResult.value.user);
      nameOk = true;
    } else {
      setNameError(nameResult.reason instanceof Error ? nameResult.reason.message : 'Something went wrong');
    }

    let passwordOk = true;
    if (bothPasswordFieldsFilled) {
      if (passwordResult.status === 'fulfilled') {
        passwordOk = true;
      } else {
        passwordOk = false;
        setPasswordError(
          passwordResult.reason instanceof Error ? passwordResult.reason.message : 'Something went wrong',
        );
      }
    }

    if (nameOk && passwordOk) {
      setCurrentPassword('');
      setNewPassword('');
      setIsEditing(false);
      toast.success('Profile updated.');
    }
  }

  if (!isEditing) {
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

        <button type="button" className="auth-submit" onClick={startEditing}>
          Edit profile
        </button>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>

      <form onSubmit={(e) => void handleSave(e)} className="auth-form profile-form">
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

        <p className="auth-hint">
          Leave password fields blank to keep your current password. At least {MIN_PASSWORD_LENGTH}{' '}
          characters.
        </p>

        {passwordError && (
          <p role="alert" className="auth-error">
            {passwordError}
          </p>
        )}

        <div className="profile-actions">
          <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Working…' : 'Save profile'}
          </button>
          <button
            type="button"
            className="auth-submit auth-submit-secondary"
            disabled={submitting}
            onClick={cancelEditing}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

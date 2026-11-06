import { useEffect, useState, type SubmitEvent } from 'react';
import toast from 'react-hot-toast';
import { adminApi } from '../../admin/api';

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddUserModal({ onClose, onCreated }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createUser(firstName, lastName, role);
      toast.success('User created. Initial password: liahwellness');
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-overlay" data-testid="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Add a user</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="admin-modal-body">
          <form onSubmit={(e) => void submit(e)} className="auth-form admin-add-user-form">
            <div className="auth-fields">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                aria-label="First name"
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                aria-label="Last name"
              />
              <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} aria-label="Role">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="auth-submit"
              disabled={busy || !firstName.trim() || !lastName.trim()}
              aria-busy={busy}
            >
              {busy ? 'Working…' : 'Create user'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

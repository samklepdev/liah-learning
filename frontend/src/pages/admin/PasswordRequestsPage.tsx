import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type PasswordResetRequest } from '../../admin/api';
import { KeyIcon, TrashIcon } from '../../shell/icons';

export function PasswordRequestsPage() {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listPasswordRequests()
      .then((res) => setRequests(res.requests))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetPassword = async (request: PasswordResetRequest) => {
    setBusyId(request.userId);
    try {
      await adminApi.resetPassword(request.userId);
      toast.success('Password reset — user must set a new one at next login.');
      setRequests((prev) => prev.filter((r) => r.userId !== request.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (request: PasswordResetRequest) => {
    setBusyId(request.userId);
    try {
      await adminApi.dismissPasswordRequest(request.userId);
      toast.success('Request dismissed.');
      setRequests((prev) => prev.filter((r) => r.userId !== request.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss request');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Password Requests</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : requests.length === 0 ? (
        <p>No pending password reset requests.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.userId}>
                <td data-label="Username">{r.username}</td>
                <td data-label="First Name">{r.firstName ?? '—'}</td>
                <td data-label="Last Name">{r.lastName ?? '—'}</td>
                <td data-label="Requested">{new Date(r.requestedAt).toLocaleString()}</td>
                <td className="admin-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === r.userId}
                    onClick={() => void resetPassword(r)}
                    aria-label="Reset password"
                    title="Reset password"
                  >
                    <KeyIcon className="icon-button-icon" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === r.userId}
                    onClick={() => void dismiss(r)}
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <TrashIcon className="icon-button-icon" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

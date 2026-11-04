import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminUser } from '../../admin/api';
import { useAuth } from '../../auth/useAuth';

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listUsers()
      .then((res) => setUsers(res.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRole = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      const nextRole = target.role === 'admin' ? 'user' : 'admin';
      const { user } = await adminApi.setRole(target.id, nextRole);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      await adminApi.deleteUser(target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Users</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="admin-actions">
                    <button
                      type="button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void toggleRole(u)}
                    >
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                    <button
                      type="button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void remove(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

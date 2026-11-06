import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type AdminAttempt, type AdminUser } from '../../admin/api';
import { useAuth } from '../../auth/useAuth';
import { Pager } from '../../shared/Pager';
import { usePager } from '../../shared/usePager';
import { ChevronRightIcon, TrashIcon, UserIcon, UserMinusIcon } from '../../shell/icons';
import { AddUserModal } from './AddUserModal';
import { AttemptsTable } from './AttemptsTable';
import { ImportUsersModal } from './ImportUsersModal';
import { UserAttemptsModal } from './UserAttemptsModal';

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const pager = usePager(total);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attemptsById, setAttemptsById] = useState<Record<string, AdminAttempt[]>>({});
  const [attemptsLoading, setAttemptsLoading] = useState<string | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
  const [modalUserId, setModalUserId] = useState<string | null>(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback((page: number) => {
    setLoading(true);
    adminApi
      .listUsers(page)
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(pager.page);
  }, [load, pager.page]);

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
      toast.success('User deleted');
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };

  const toggleAttempts = async (target: AdminUser) => {
    if (expandedId === target.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(target.id);
    setAttemptsError(null);
    if (attemptsById[target.id]) return;

    setAttemptsLoading(target.id);
    try {
      const { attempts } = await adminApi.getUserAttempts(target.id);
      setAttemptsById((prev) => ({ ...prev, [target.id]: attempts }));
    } catch (err) {
      setAttemptsError(err instanceof Error ? err.message : 'Failed to load attempts');
    } finally {
      setAttemptsLoading(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Users</h1>

      <div className="admin-user-actions">
        <button type="button" className="auth-submit-secondary" onClick={() => setShowAddUser(true)}>
          Add user
        </button>
        <button type="button" className="auth-submit-secondary" onClick={() => setShowImport(true)}>
          Seed users from a file
        </button>
      </div>

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
              <th>Username</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <Fragment key={u.id}>
                  <tr>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="First Name">{u.firstName ?? '—'}</td>
                    <td data-label="Last Name">{u.lastName ?? '—'}</td>
                    <td data-label="Role">{u.role}</td>
                    <td data-label="Joined">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void toggleAttempts(u)}
                        aria-label={expandedId === u.id ? 'Hide attempts' : 'View attempts'}
                        title={expandedId === u.id ? 'Hide attempts' : 'View attempts'}
                      >
                        <ChevronRightIcon
                          className={
                            expandedId === u.id ? 'attempts-toggle-icon open' : 'attempts-toggle-icon'
                          }
                        />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={isSelf || busyId === u.id}
                        onClick={() => void toggleRole(u)}
                        aria-label={u.role === 'admin' ? 'Make user' : 'Make admin'}
                        title={u.role === 'admin' ? 'Make user' : 'Make admin'}
                      >
                        {u.role === 'admin' ? (
                          <UserMinusIcon className="icon-button-icon" />
                        ) : (
                          <UserIcon className="icon-button-icon" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={isSelf || busyId === u.id}
                        onClick={() => void remove(u)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <TrashIcon className="icon-button-icon" />
                      </button>
                    </td>
                  </tr>
                  {expandedId === u.id && (
                    <tr className="admin-attempts-row">
                      <td colSpan={6}>
                        {attemptsLoading === u.id ? (
                          <p>Loading attempts…</p>
                        ) : attemptsError ? (
                          <p role="alert" className="auth-error">
                            {attemptsError}
                          </p>
                        ) : (attemptsById[u.id]?.length ?? 0) === 0 ? (
                          <p>No attempts yet.</p>
                        ) : (
                          <>
                            <AttemptsTable attempts={attemptsById[u.id]!.slice(0, 5)} />
                            {attemptsById[u.id]!.length > 5 && (
                              <button
                                type="button"
                                className="auth-submit-secondary"
                                onClick={() => setModalUserId(u.id)}
                              >
                                View all {attemptsById[u.id]!.length} attempts
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && (
        <Pager
          page={pager.page}
          totalPages={pager.totalPages}
          canPrev={pager.canPrev}
          canNext={pager.canNext}
          onPrev={pager.prev}
          onNext={pager.next}
        />
      )}

      {modalUserId && (
        <UserAttemptsModal
          userLabel={users.find((u) => u.id === modalUserId)?.username ?? ''}
          attempts={attemptsById[modalUserId] ?? []}
          onClose={() => setModalUserId(null)}
        />
      )}

      {showAddUser && (
        <AddUserModal onClose={() => setShowAddUser(false)} onCreated={() => load(pager.page)} />
      )}

      {showImport && (
        <ImportUsersModal onClose={() => setShowImport(false)} onImported={() => load(pager.page)} />
      )}
    </div>
  );
}

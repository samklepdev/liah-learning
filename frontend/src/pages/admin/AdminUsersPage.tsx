import { Fragment, useCallback, useEffect, useState, type SubmitEvent } from 'react';
import toast from 'react-hot-toast';
import {
  adminApi,
  type AdminAttempt,
  type AdminUser,
  type ConfirmedUser,
  type ImportedUserRow,
  type ImportRowError,
  type SkippedUser,
} from '../../admin/api';
import { useAuth } from '../../auth/useAuth';
import { Pager } from '../../shared/Pager';
import { PAGE_SIZE, usePager } from '../../shared/usePager';
import { ChevronRightIcon, TrashIcon, UserIcon, UserMinusIcon } from '../../shell/icons';
import { AttemptsTable } from './AttemptsTable';
import { UserAttemptsModal } from './UserAttemptsModal';

type ImportResults = { created: ConfirmedUser[]; skipped: SkippedUser[] };

function importSummary(created: number, skipped: number): string {
  const createdPart = `${created} user${created === 1 ? '' : 's'} created`;
  return skipped > 0 ? `${createdPart}, ${skipped} skipped` : createdPart;
}

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

  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportedUserRow[]>([]);
  const previewPager = usePager(parsedRows.length);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const createdPager = usePager(importResults?.created.length ?? 0);
  const skippedPager = usePager(importResults?.skipped.length ?? 0);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);

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

  const parseFile = async () => {
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);
    setImportResults(null);
    setParsedRows([]);
    setParseErrors([]);
    try {
      const { rows, errors } = await adminApi.parseUserImport(importFile);
      setParsedRows(rows);
      setParseErrors(errors);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = async () => {
    if (parsedRows.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const results = await adminApi.confirmUserImport(parsedRows);
      toast.success(importSummary(results.created.length, results.skipped.length));
      setImportResults(results);
      setParsedRows([]);
      setParseErrors([]);
      setImportFile(null);
      load(pager.page);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const addUser = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddUserBusy(true);
    setAddUserError(null);
    try {
      await adminApi.createUser(newFirstName, newLastName, newRole);
      toast.success('User created. Initial password: liahwellness');
      setNewFirstName('');
      setNewLastName('');
      setNewRole('user');
      load(pager.page);
    } catch (err) {
      setAddUserError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAddUserBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>Users</h1>

      <section className="admin-add-user">
        <h2>Add a user</h2>
        <form onSubmit={(e) => void addUser(e)} className="auth-form admin-add-user-form">
          <div className="auth-fields">
            <input
              type="text"
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              placeholder="First name"
              aria-label="First name"
            />
            <input
              type="text"
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              placeholder="Last name"
              aria-label="Last name"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
              aria-label="Role"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {addUserError && (
            <p role="alert" className="auth-error">
              {addUserError}
            </p>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={addUserBusy || !newFirstName.trim() || !newLastName.trim()}
            aria-busy={addUserBusy}
          >
            {addUserBusy ? 'Working…' : 'Add user'}
          </button>
        </form>
      </section>

      <section className="admin-import-users">
        <h2>Seed users from a file</h2>
        <div className="auth-form import-form">
          <div className="auth-fields">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              aria-label="User list file"
            />
          </div>

          {importError && (
            <p role="alert" className="auth-error">
              {importError}
            </p>
          )}

          <button
            type="button"
            className="auth-submit"
            disabled={importBusy || !importFile}
            aria-busy={importBusy}
            onClick={() => void parseFile()}
          >
            {importBusy ? 'Working…' : 'Parse'}
          </button>
        </div>

        {parseErrors.length > 0 && (
          <div className="import-errors" role="alert">
            <h3>Row errors</h3>
            <ul>
              {parseErrors.map((e) => (
                <li key={e.row}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {parsedRows.length > 0 && (
          <div className="import-preview">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows
                  .slice((previewPager.page - 1) * PAGE_SIZE, previewPager.page * PAGE_SIZE)
                  .map((r) => (
                    <tr key={r.row}>
                      <td data-label="First Name">{r.firstName}</td>
                      <td data-label="Last Name">{r.lastName}</td>
                      <td data-label="Role">{r.role}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <Pager
              page={previewPager.page}
              totalPages={previewPager.totalPages}
              canPrev={previewPager.canPrev}
              canNext={previewPager.canNext}
              onPrev={previewPager.prev}
              onNext={previewPager.next}
            />
            <button
              type="button"
              className="auth-submit"
              disabled={importBusy}
              aria-busy={importBusy}
              onClick={() => void confirmImport()}
            >
              Confirm import
            </button>
          </div>
        )}

        {importResults && (
          <div className="import-results">
            {importResults.created.length > 0 && (
              <>
                <h3>Created</h3>
                <p>Initial password for all created users: <code>liahwellness</code></p>
                <button
                  type="button"
                  onClick={() => {
                    const header = 'username,firstName,lastName,role';
                    const lines = importResults.created.map(
                      (u) => `${u.username},${u.firstName ?? ''},${u.lastName ?? ''},${u.role}`,
                    );
                    void navigator.clipboard.writeText([header, ...lines].join('\n'));
                  }}
                >
                  Copy all as CSV
                </button>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.created
                      .slice((createdPager.page - 1) * PAGE_SIZE, createdPager.page * PAGE_SIZE)
                      .map((u) => (
                        <tr key={u.username}>
                          <td data-label="Username">{u.username}</td>
                          <td data-label="First Name">{u.firstName ?? '—'}</td>
                          <td data-label="Last Name">{u.lastName ?? '—'}</td>
                          <td data-label="Role">{u.role}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <Pager
                  page={createdPager.page}
                  totalPages={createdPager.totalPages}
                  canPrev={createdPager.canPrev}
                  canNext={createdPager.canNext}
                  onPrev={createdPager.prev}
                  onNext={createdPager.next}
                />
              </>
            )}
            {importResults.skipped.length > 0 && (
              <>
                <h3>Skipped</h3>
                <ul>
                  {importResults.skipped
                    .slice((skippedPager.page - 1) * PAGE_SIZE, skippedPager.page * PAGE_SIZE)
                    .map((s, i) => (
                      <li key={`${s.firstName ?? ''}-${s.lastName ?? ''}-${i}`}>
                        {s.firstName} {s.lastName}: {s.reason}
                      </li>
                    ))}
                </ul>
                <Pager
                  page={skippedPager.page}
                  totalPages={skippedPager.totalPages}
                  canPrev={skippedPager.canPrev}
                  canNext={skippedPager.canNext}
                  onPrev={skippedPager.prev}
                  onNext={skippedPager.next}
                />
              </>
            )}
          </div>
        )}
      </section>

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
    </div>
  );
}

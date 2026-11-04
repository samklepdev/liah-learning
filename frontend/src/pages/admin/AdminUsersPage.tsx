import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AdminUser,
  type ConfirmedUser,
  type ImportedUserRow,
  type ImportRowError,
  type SkippedUser,
} from '../../admin/api';
import { useAuth } from '../../auth/useAuth';

type ImportResults = { created: ConfirmedUser[]; skipped: SkippedUser[] };

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportedUserRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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
      setImportResults(results);
      setParsedRows([]);
      setParseErrors([]);
      setImportFile(null);
      load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>Users</h1>

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
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.name ?? '—'}</td>
                    <td>{r.email}</td>
                    <td>{r.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                <button
                  type="button"
                  onClick={() => {
                    const header = 'email,name,role,password';
                    const lines = importResults.created.map(
                      (u) => `${u.email},${u.name ?? ''},${u.role},${u.password}`,
                    );
                    void navigator.clipboard.writeText([header, ...lines].join('\n'));
                  }}
                >
                  Copy all as CSV
                </button>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.created.map((u) => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>{u.name ?? '—'}</td>
                        <td>{u.role}</td>
                        <td>{u.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {importResults.skipped.length > 0 && (
              <>
                <h3>Skipped</h3>
                <ul>
                  {importResults.skipped.map((s) => (
                    <li key={s.email}>
                      {s.email}: {s.reason}
                    </li>
                  ))}
                </ul>
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
              <th>Email</th>
              <th>Name</th>
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
                  <td>{u.name ?? '—'}</td>
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

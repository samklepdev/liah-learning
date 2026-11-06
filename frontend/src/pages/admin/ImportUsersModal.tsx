import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  adminApi,
  type ConfirmedUser,
  type ImportedUserRow,
  type ImportRowError,
  type SkippedUser,
} from '../../admin/api';
import { Pager } from '../../shared/Pager';
import { PAGE_SIZE, usePager } from '../../shared/usePager';

type ImportResults = { created: ConfirmedUser[]; skipped: SkippedUser[] };

function importSummary(created: number, skipped: number): string {
  const createdPart = `${created} user${created === 1 ? '' : 's'} created`;
  return skipped > 0 ? `${createdPart}, ${skipped} skipped` : createdPart;
}

type Props = {
  onClose: () => void;
  onImported: () => void;
};

export function ImportUsersModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportedUserRow[]>([]);
  const previewPager = usePager(parsedRows.length);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [results, setResults] = useState<ImportResults | null>(null);
  const createdPager = usePager(results?.created.length ?? 0);
  const skippedPager = usePager(results?.skipped.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const parseFile = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResults(null);
    setParsedRows([]);
    setParseErrors([]);
    try {
      const { rows, errors } = await adminApi.parseUserImport(file);
      setParsedRows(rows);
      setParseErrors(errors);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (parsedRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await adminApi.confirmUserImport(parsedRows);
      toast.success(importSummary(imported.created.length, imported.skipped.length));
      setResults(imported);
      setParsedRows([]);
      setParseErrors([]);
      setFile(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-overlay" data-testid="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal admin-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>Seed users from a file</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="admin-modal-body">
          <div className="auth-form import-form">
            <div className="auth-fields">
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="User list file"
              />
            </div>

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}

            <button
              type="button"
              className="auth-submit"
              disabled={busy || !file}
              aria-busy={busy}
              onClick={() => void parseFile()}
            >
              {busy ? 'Working…' : 'Parse'}
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
                disabled={busy}
                aria-busy={busy}
                onClick={() => void confirmImport()}
              >
                Confirm import
              </button>
            </div>
          )}

          {results && (
            <div className="import-results">
              {results.created.length > 0 && (
                <>
                  <h3>Created</h3>
                  <p>
                    Initial password for all created users: <code>liahwellness</code>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const header = 'username,firstName,lastName,role';
                      const lines = results.created.map(
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
                      {results.created
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
              {results.skipped.length > 0 && (
                <>
                  <h3>Skipped</h3>
                  <ul>
                    {results.skipped
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
        </div>
      </div>
    </div>
  );
}

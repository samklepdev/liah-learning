import { useId, useState } from 'react';
import { adminApi, type ImportSummary, type ParsedSubjectPayload } from '../../admin/api';

type ParseResult =
  | { kind: 'summary'; summary: ImportSummary; subject: ParsedSubjectPayload }
  | { kind: 'errors'; errors: string[] };

export function AdminImportPage() {
  const titleId = useId();
  const fileId = useId();
  const [subjectTitle, setSubjectTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = async () => {
    if (!file || !subjectTitle.trim()) return;
    setBusy(true);
    setError(null);
    setImported(null);
    try {
      const res = await adminApi.parseImport(file, subjectTitle);
      if ('errors' in res) {
        setResult({ kind: 'errors', errors: res.errors });
      } else {
        setResult({ kind: 'summary', summary: res.summary, subject: res.subject });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!result || result.kind !== 'summary') return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.confirmImport(result.subject);
      setImported(res);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>Import quiz content</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="import-form">
        <label htmlFor={titleId}>Subject title</label>
        <input
          id={titleId}
          type="text"
          value={subjectTitle}
          onChange={(e) => setSubjectTitle(e.target.value)}
        />

        <label htmlFor={fileId}>PDF file</label>
        <input
          id={fileId}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          disabled={busy || !file || !subjectTitle.trim()}
          onClick={() => void parse()}
        >
          Parse
        </button>
      </div>

      {result?.kind === 'errors' && (
        <div className="import-errors" role="alert">
          <h2>Parse errors</h2>
          <ul>
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.kind === 'summary' && (
        <div className="import-preview">
          <p>
            Parsed {result.summary.courses} courses, {result.summary.questions} questions.
          </p>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            Confirm import
          </button>
        </div>
      )}

      {imported && (
        <p className="import-success">
          Imported: {imported.courses} courses, {imported.questions} questions.
        </p>
      )}
    </div>
  );
}

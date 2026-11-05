import type { AdminAttempt } from '../../admin/api';

function formatScore(attempt: AdminAttempt): string {
  return attempt.submittedAt ? String(attempt.score ?? 0) : '—';
}

function formatStatus(attempt: AdminAttempt): string {
  return attempt.submittedAt ? 'Completed' : 'In progress';
}

function formatDate(attempt: AdminAttempt): string {
  return new Date(attempt.submittedAt ?? attempt.startedAt).toLocaleDateString();
}

export function AttemptsTable({ attempts }: { attempts: AdminAttempt[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Course</th>
          <th>Score</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td>{attempt.subjectSlug}</td>
            <td>{attempt.courseTitle}</td>
            <td>{formatScore(attempt)}</td>
            <td>{formatStatus(attempt)}</td>
            <td>{formatDate(attempt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

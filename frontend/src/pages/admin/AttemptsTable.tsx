import type { AdminAttempt } from '../../admin/api';

function formatScore(attempt: AdminAttempt): string {
  return attempt.submittedAt ? String(attempt.score ?? 0) : '—';
}

function formatStatus(attempt: AdminAttempt): string {
  if (attempt.submittedAt) return 'Completed';
  return attempt.answeredCount > 0 ? 'In progress' : 'Not started';
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
            <td data-label="Subject">{attempt.subjectSlug}</td>
            <td data-label="Course">{attempt.courseTitle}</td>
            <td data-label="Score">{formatScore(attempt)}</td>
            <td data-label="Status">{formatStatus(attempt)}</td>
            <td data-label="Date">{formatDate(attempt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

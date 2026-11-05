import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { quizApi, type ProgressCourse } from '../quiz/api';

type State = { kind: 'ready'; courses: ProgressCourse[] } | { kind: 'error'; message: string };

export function ProgressPage() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { courses } = await quizApi.getMyProgress();
        if (!cancelled) setState({ kind: 'ready', courses });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load your progress',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null) return <div className="auth-loading">Loading your progress…</div>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {state.message}
      </p>
    );
  }

  const { courses } = state;

  return (
    <div className="course-list">
      <h1>My Progress</h1>

      {courses.length === 0 ? (
        <p className="course-intro">You haven&apos;t completed any quizzes yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Course</th>
              <th>Best score</th>
              <th>Attempts</th>
              <th>Last completed</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.courseId}>
                <td>{c.subjectSlug}</td>
                <td>
                  <Link to={`/courses/${c.courseSlug}/results/${c.lastAttemptId}`}>
                    {c.courseTitle}
                  </Link>
                </td>
                <td>
                  {c.bestScore}/{c.questionCount}
                </td>
                <td>{c.attemptCount}</td>
                <td>{new Date(c.lastSubmittedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

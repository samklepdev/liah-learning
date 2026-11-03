import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { quizApi, type CourseSummary } from '../quiz/api';

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    quizApi
      .listCourses('chassis')
      .then(({ courses }) => {
        if (!cancelled) setCourses(courses);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load courses');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="auth-error">
        {error}
      </p>
    );
  }
  if (!courses) return <div className="auth-loading">Loading courses…</div>;

  return (
    <div className="course-list">
      <h1>Chassis Program</h1>
      <p className="course-intro">
        {courses.length} courses. Take a quiz after finishing each one; aim for 9 out of 10.
      </p>

      <ul>
        {courses.map((c) => (
          <li key={c.id} className="course-row">
            <div>
              <span className="course-position">Course {c.position}</span>
              <Link to={`/courses/${c.slug}/quiz`}>{c.title}</Link>
            </div>
            <div className="course-score">
              {c.bestScore === null ? (
                <span className="course-untaken">Not attempted</span>
              ) : (
                <span className={c.bestScore >= c.passScore ? 'course-passed' : 'course-below'}>
                  Best {c.bestScore}/{c.questionCount}
                  {c.attemptCount > 1 ? ` · ${c.attemptCount} attempts` : ''}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

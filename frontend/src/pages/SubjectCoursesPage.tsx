import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { quizApi, type CourseSummary } from '../quiz/api';
import { PassBadge } from '../quiz/PassBadge';
import { hasPassed } from '../quiz/passed';
import { useCatalog } from '../quiz/useCatalog';

type State =
  | { kind: 'ready'; slug: string; courses: CourseSummary[] }
  | { kind: 'error'; slug: string; message: string };

export function SubjectCoursesPage() {
  const { subjectSlug = '' } = useParams();
  const { subjects } = useCatalog();
  const [state, setState] = useState<State | null>(null);

  // Keyed on slug so switching subjects shows loading without an explicit reset.
  const current = state?.slug === subjectSlug ? state : null;
  const subject = subjects.find((s) => s.slug === subjectSlug);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { courses } = await quizApi.listCourses(subjectSlug);
        if (!cancelled) setState({ kind: 'ready', slug: subjectSlug, courses });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            slug: subjectSlug,
            message: err instanceof Error ? err.message : 'Could not load quizzes',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [subjectSlug]);

  if (current === null) return <div className="auth-loading">Loading quizzes…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { courses } = current;

  return (
    <div className="course-list">
      <h1>{subject?.title ?? subjectSlug}</h1>
      <p className="course-intro">
        {courses.length} {courses.length === 1 ? 'quiz' : 'quizzes'}, one per course. Take
        one after finishing a course; aim for 9 out of 10.
      </p>

      <ul>
        {courses.map((c) => (
          <li key={c.id} className="course-row">
            <div>
              <span className="course-position">Quiz {c.position}</span>
              <Link to={`/courses/${c.slug}/quiz`}>{c.title}</Link>
            </div>
            <div className="course-score">
              <PassBadge bestScore={c.bestScore} passScore={c.passScore} />
              {c.bestScore === null ? (
                <span className="course-untaken">Not attempted</span>
              ) : (
                <span
                  className={
                    hasPassed(c.bestScore, c.passScore) ? 'course-passed' : 'course-below'
                  }
                >
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

/** Shown at /subjects, before a subject is chosen. */
export function SubjectsIndexPage() {
  const { subjects } = useCatalog();

  return (
    <div className="course-list">
      <h1>Choose a subject</h1>
      <p className="course-intro">
        {subjects.length} {subjects.length === 1 ? 'subject' : 'subjects'} available. Pick
        one to see its quizzes.
      </p>

      <ul>
        {subjects.map((s) => (
          <li key={s.id} className="course-row">
            <Link to={`/subjects/${s.slug}`}>{s.title}</Link>
            <span className="course-score course-untaken">
              {s.courseCount} {s.courseCount === 1 ? 'quiz' : 'quizzes'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

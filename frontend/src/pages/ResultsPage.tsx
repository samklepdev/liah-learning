import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { quizApi, type GradedAttempt } from '../quiz/api';
import { ResultsBreakdown } from '../quiz/ResultsBreakdown';
import { PassBadge } from '../quiz/PassBadge';
import { hasPassed } from '../quiz/passed';

type State =
  | { kind: 'ready'; attemptId: string; attempt: GradedAttempt }
  | { kind: 'error'; attemptId: string; message: string };

export function ResultsPage() {
  const { slug = '', attemptId = '' } = useParams();
  const [state, setState] = useState<State | null>(null);

  // Same slug-keyed pattern as useQuizAttempt: loading is derived, so nothing
  // is assigned synchronously inside the effect.
  const current = state?.attemptId === attemptId ? state : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { attempt } = await quizApi.getAttempt(attemptId);
        if (cancelled) return;
        if (!('score' in attempt)) {
          setState({
            kind: 'error',
            attemptId,
            message: 'That attempt has not been submitted yet.',
          });
          return;
        }
        setState({ kind: 'ready', attemptId, attempt });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          attemptId,
          message: err instanceof Error ? err.message : 'Could not load the result',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (current === null) return <div className="auth-loading">Loading result…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { attempt } = current;
  // Best-ever, so a weaker retake never replaces a better number nor revokes
  // the badge. previousBest excludes the attempt being viewed, hence the max.
  const bestScore = Math.max(attempt.score, attempt.previousBest ?? attempt.score);
  const passed = hasPassed(bestScore, attempt.passScore);

  return (
    <div className="results-page">
      <div className="score-block">
        <div className="score-number">
          {bestScore}
          <span className="score-of">/{attempt.questionCount}</span>
        </div>
        <PassBadge bestScore={bestScore} passScore={attempt.passScore} />
        <p className={passed ? 'course-passed' : 'course-below'}>
          {passed
            ? `Target of ${attempt.passScore}/${attempt.questionCount} met`
            : `Target is ${attempt.passScore}/${attempt.questionCount} — not there yet`}
        </p>
        {/* Only when it differs from the headline, so a first attempt shows no
            redundant line. */}
        {bestScore > attempt.score && (
          <p className="score-previous">
            This attempt: {attempt.score}/{attempt.questionCount}
          </p>
        )}
      </div>

      {attempt.modulesToReview.length > 0 && (
        <div className="modules-block">
          <p className="label">Modules to review</p>
          <p>{attempt.modulesToReview.join(' · ')}</p>
        </div>
      )}

      <p className="label">All {attempt.questionCount} questions from this attempt</p>
      <ResultsBreakdown questions={attempt.questions} />

      <div className="results-actions">
        <Link className="primary" to={`/courses/${slug}/quiz`}>
          Retake quiz
        </Link>
        <Link to={`/subjects/${attempt.subjectSlug}`}>Back to quizzes</Link>
      </div>
    </div>
  );
}

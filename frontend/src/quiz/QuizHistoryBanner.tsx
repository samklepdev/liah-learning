import { PassBadge } from './PassBadge';

/**
 * Your record on this course, shown above a retake. Renders nothing before the
 * first submission, so a first attempt is not cluttered by an empty record.
 *
 * Summary numbers only — never per-question history. The quiz payload
 * deliberately carries no answer key, and showing a previous attempt's
 * breakdown here would hand it over mid-retake.
 */
export function QuizHistoryBanner({
  bestScore,
  attemptCount,
  passScore,
  questionCount,
}: {
  bestScore: number | null;
  attemptCount: number;
  passScore: number;
  questionCount: number;
}) {
  if (attemptCount === 0) return null;

  return (
    <div className="quiz-history">
      <PassBadge bestScore={bestScore} passScore={passScore} />
      <span>
        Best {bestScore}/{questionCount} · {attemptCount}{' '}
        {attemptCount === 1 ? 'attempt' : 'attempts'}
      </span>
    </div>
  );
}

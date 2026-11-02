import type { QuizQuestion } from './api';

export function ReviewGrid({
  questions,
  answers,
  onJump,
  onSubmit,
  submitting,
}: {
  questions: QuizQuestion[];
  answers: Record<string, string>;
  onJump: (index: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const unanswered = questions.filter((q) => !answers[q.id]);

  return (
    <div className="review-grid">
      <h2>Review before submitting</h2>
      <p className={unanswered.length ? 'review-warning' : 'review-ok'}>
        {unanswered.length === 0
          ? `All ${questions.length} questions answered.`
          : `Answered ${questions.length - unanswered.length} of ${questions.length} — ` +
            `${unanswered.length} still blank. Blank answers are marked wrong.`}
      </p>

      <div className="review-cells">
        {questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            className={answers[q.id] ? 'review-cell answered' : 'review-cell blank'}
            onClick={() => onJump(i)}
            aria-label={`Question ${q.position}, ${answers[q.id] ? 'answered' : 'blank'}`}
          >
            {q.position}
          </button>
        ))}
      </div>

      <button type="button" className="primary" onClick={onSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit quiz'}
      </button>
    </div>
  );
}

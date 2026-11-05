import { useNavigate, useParams } from 'react-router';
import { QuestionCard } from '../quiz/QuestionCard';
import { ReviewGrid } from '../quiz/ReviewGrid';
import { QuizHistoryBanner } from '../quiz/QuizHistoryBanner';
import { useQuizAttempt } from '../quiz/useQuizAttempt';

export function QuizPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const state = useQuizAttempt(slug);

  if (state.loading) return <div className="auth-loading">Loading quiz…</div>;
  if (state.error) {
    return (
      <p role="alert" className="auth-error">
        {state.error}
      </p>
    );
  }
  if (!state.quiz) {
    return (
      <p role="alert" className="auth-error">
        Quiz not found
      </p>
    );
  }

  const { quiz, index, answers, history } = state;
  const total = quiz.questions.length;
  const onReview = index >= total;

  async function handleSubmit() {
    const attemptId = await state.submit();
    if (attemptId) navigate(`/courses/${slug}/results/${attemptId}`);
  }

  return (
    <div className="quiz-page">
      {history && (
        <QuizHistoryBanner
          bestScore={history.bestScore}
          attemptCount={history.attemptCount}
          passScore={quiz.passScore}
          questionCount={quiz.questionCount}
        />
      )}

      <div className="quiz-header">
        <span>{quiz.title}</span>
        <span>{onReview ? 'Review' : `Question ${index + 1} of ${total}`}</span>
      </div>

      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${(Math.min(index, total) / total) * 100}%` }}
        />
      </div>

      {state.actionError && (
        <p role="alert" className="auth-error">
          {state.actionError}
        </p>
      )}

      {onReview ? (
        <ReviewGrid
          questions={quiz.questions}
          answers={answers}
          onJump={state.goTo}
          onSubmit={() => void handleSubmit()}
          submitting={state.submitting}
        />
      ) : (
        <QuestionCard
          question={quiz.questions[index]!}
          selectedOptionId={answers[quiz.questions[index]!.id]}
          onSelect={(optionId) => state.select(quiz.questions[index]!.id, optionId)}
        />
      )}

      <div className="quiz-nav">
        <button type="button" className="primary" onClick={state.back} disabled={index === 0}>
          Back
        </button>
        <span className="quiz-saving">{state.saving ? 'Saving…' : ''}</span>
        {!onReview && (
          <button type="button" className="primary" onClick={state.next}>
            {index === total - 1 ? 'Review' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}

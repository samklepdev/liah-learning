import { useState } from 'react';
import type { GradedQuestion } from './api';

function MissedQuestion({ question }: { question: GradedQuestion }) {
  const chosen = question.options.find((o) => o.id === question.selectedOptionId);
  const correct = question.options.find((o) => o.isCorrect)!;

  return (
    <li className="result-missed">
      <p className="result-q">
        ✕ {question.position}. {question.prompt}
      </p>
      <p className="result-line">
        {chosen ? (
          <>
            You chose <strong>{chosen.label}</strong> — {chosen.body}
          </>
        ) : (
          <em>You left this blank</em>
        )}
      </p>
      <p className="result-line">
        Correct is <strong>{correct.label}</strong> — {correct.body}
      </p>
      <p className="result-explanation">{question.explanation}</p>
      <span className="result-module">{question.moduleTitle}</span>
    </li>
  );
}

function CorrectQuestion({ question }: { question: GradedQuestion }) {
  const [open, setOpen] = useState(false);
  const chosen = question.options.find((o) => o.id === question.selectedOptionId);

  return (
    <li className="result-correct">
      <button type="button" className="result-toggle" onClick={() => setOpen(!open)}>
        <span>
          ✓ {question.position}. {question.prompt}
        </span>
        <span className="result-answer">{chosen?.label}</span>
      </button>
      {open && <p className="result-explanation">{question.explanation}</p>}
    </li>
  );
}

export function ResultsBreakdown({ questions }: { questions: GradedQuestion[] }) {
  return (
    <ul className="result-list">
      {questions.map((q) =>
        q.wasCorrect ? (
          <CorrectQuestion key={q.id} question={q} />
        ) : (
          <MissedQuestion key={q.id} question={q} />
        ),
      )}
    </ul>
  );
}

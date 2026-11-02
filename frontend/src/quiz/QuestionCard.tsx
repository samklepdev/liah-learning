import type { QuizQuestion } from './api';

export function QuestionCard({
  question,
  selectedOptionId,
  onSelect,
}: {
  question: QuizQuestion;
  selectedOptionId: string | undefined;
  onSelect: (optionId: string) => void;
}) {
  return (
    <div className="question-card">
      <p className="question-module">{question.moduleTitle}</p>
      <p className="question-prompt">{question.prompt}</p>

      <ul className="option-list">
        {question.options.map((o) => (
          <li key={o.id}>
            <label className={o.id === selectedOptionId ? 'option selected' : 'option'}>
              <input
                type="radio"
                name={`q-${question.id}`}
                value={o.id}
                checked={o.id === selectedOptionId}
                onChange={() => onSelect(o.id)}
              />
              <span className="option-label">{o.label}</span>
              <span>{o.body}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeCourseHistory, makeQuiz } from '../test/fixtures';
import { QuizPage } from './QuizPage';

const quiz = makeQuiz();

const getQuiz = vi.fn();
const startAttempt = vi.fn();
const getAttempt = vi.fn();
const saveAnswer = vi.fn();
const submit = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: {
      listCourses: vi.fn(),
      getQuiz: (...a: unknown[]) => getQuiz(...a),
      startAttempt: (...a: unknown[]) => startAttempt(...a),
      getAttempt: (...a: unknown[]) => getAttempt(...a),
      saveAnswer: (...a: unknown[]) => saveAnswer(...a),
      submit: (...a: unknown[]) => submit(...a),
    },
  };
});

beforeEach(() => {
  getQuiz.mockResolvedValue({ quiz, history: makeCourseHistory() });
  startAttempt.mockResolvedValue({ attempt: { id: 'attempt-1' } });
  getAttempt.mockResolvedValue({
    attempt: {
      id: 'attempt-1',
      courseId: 'course-1',
      startedAt: '2026-11-02T12:00:00.000Z',
      submittedAt: null,
      answers: [],
    },
  });
  saveAnswer.mockResolvedValue(undefined);
  submit.mockResolvedValue({ attempt: {} });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/courses/${quiz.slug}/quiz`]}>
      <Routes>
        <Route path="/courses/:slug/quiz" element={<QuizPage />} />
        <Route path="/courses/:slug/results/:attemptId" element={<div>RESULTS PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('QuizPage', () => {
  test('shows one question at a time with its module and four options', async () => {
    renderPage();

    expect(await screen.findByText('Question 1 prompt?')).toBeInTheDocument();
    expect(screen.getByText('Module 1')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    // Nothing from question 2 should be on screen.
    expect(screen.queryByText('Question 2 prompt?')).not.toBeInTheDocument();
  });

  test('never reveals correctness while taking the quiz', async () => {
    const { container } = renderPage();
    await screen.findByText('Question 1 prompt?');

    expect(container.textContent).not.toMatch(/correct/i);
    expect(container.textContent).not.toMatch(/Because of reason/);
  });

  test('Back is disabled on the first question', async () => {
    renderPage();
    await screen.findByText('Question 1 prompt?');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  test('selecting an answer saves it', async () => {
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('radio', { name: /Answer B for 1/ }));

    await waitFor(() =>
      expect(saveAnswer).toHaveBeenCalledWith('attempt-1', 'q1', 'q1-B'),
    );
    expect(screen.getByRole('radio', { name: /Answer B for 1/ })).toBeChecked();
  });

  test('navigates forward and back, keeping the chosen answer', async () => {
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('radio', { name: /Answer B for 1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Question 2 prompt?')).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('radio', { name: /Answer B for 1/ })).toBeChecked();
  });

  test('the last question offers Review, which warns about blanks', async () => {
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // On the final question the forward button becomes "Review".
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('Review before submitting')).toBeInTheDocument();
    expect(screen.getByText(/3 still blank/)).toBeInTheDocument();
    expect(screen.getByText(/marked wrong/)).toBeInTheDocument();
  });

  test('the review grid reports a complete quiz and jumps back to a question', async () => {
    getAttempt.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        courseId: 'course-1',
        startedAt: '2026-11-02T12:00:00.000Z',
        submittedAt: null,
        answers: [
          { questionId: 'q1', optionId: 'q1-A' },
          { questionId: 'q2', optionId: 'q2-A' },
          { questionId: 'q3', optionId: 'q3-A' },
        ],
      },
    });
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('All 3 questions answered.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Question 2, answered' }));
    expect(screen.getByText('Question 2 prompt?')).toBeInTheDocument();
  });

  test('submitting navigates to the results route', async () => {
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit quiz' }));

    await waitFor(() => expect(screen.getByText('RESULTS PAGE')).toBeInTheDocument());
    expect(submit).toHaveBeenCalledWith('attempt-1');
  });

  test('a failed submit stays on the quiz and shows the error', async () => {
    submit.mockRejectedValue(new Error('could not submit'));
    renderPage();
    await screen.findByText('Question 1 prompt?');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit quiz' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('could not submit'),
    );
    expect(screen.queryByText('RESULTS PAGE')).not.toBeInTheDocument();
    expect(screen.getByText('Review before submitting')).toBeInTheDocument();
  });

  test('shows no history banner on a first attempt', async () => {
    renderPage();
    await screen.findByText('Question 1 of 3');

    expect(screen.queryByText(/Best /)).not.toBeInTheDocument();
  });

  test('shows the best score and badge when retaking a passed quiz', async () => {
    getQuiz.mockResolvedValue({
      quiz,
      history: makeCourseHistory({ bestScore: 3, attemptCount: 2 }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Best 3/3 · 2 attempts')).toBeInTheDocument();
  });

  test('shows the best score without a badge when the quiz is not yet passed', async () => {
    getQuiz.mockResolvedValue({
      quiz,
      history: makeCourseHistory({ bestScore: 2, attemptCount: 1 }),
    });
    renderPage();

    expect(await screen.findByText('Best 2/3 · 1 attempt')).toBeInTheDocument();
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  });
});

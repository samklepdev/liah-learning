import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeGradedAttempt } from '../test/fixtures';
import { ApiError } from '../quiz/api';
import { ResultsPage } from './ResultsPage';

const getAttempt = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getAttempt: (id: string) => getAttempt(id) },
  };
});

const SLUG = 'chassis-tire-and-rim-essentials';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/courses/${SLUG}/results/attempt-1`]}>
      <Routes>
        <Route path="/courses/:slug/results/:attemptId" element={<ResultsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getAttempt.mockResolvedValue({ attempt: makeGradedAttempt() });
});

describe('ResultsPage', () => {
  test('shows the score against the target', async () => {
    renderPage();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('/3')).toBeInTheDocument();
    expect(screen.getByText(/Target is 3\/3 — not there yet/)).toBeInTheDocument();
  });

  test('reports hitting the target', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 3, modulesToReview: [] }),
    });
    renderPage();

    expect(await screen.findByText(/Target of 3\/3 met/)).toBeInTheDocument();
  });

  test('shows this attempt only when a better one exists', async () => {
    renderPage();
    await screen.findByText(/not there yet/);
    // Best-ever equals this attempt, so there is nothing to distinguish.
    expect(screen.queryByText(/This attempt/)).not.toBeInTheDocument();
  });

  test('keeps the badge when this attempt is below a target already met', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 2, previousBest: 3 }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(screen.getByText(/Target of 3\/3 met/)).toBeInTheDocument();
    expect(screen.getByText('This attempt: 2/3')).toBeInTheDocument();
  });

  test('headlines the best score, not a weaker retake', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 2, previousBest: 3 }),
    });
    renderPage();

    const block = (await screen.findByText(/Target of/)).closest('.score-block');
    expect(block).not.toBeNull();
    // The headline reads 3, not the 2 scored on this attempt.
    expect(within(block as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(block as HTMLElement).queryByText('2')).not.toBeInTheDocument();
  });

  test('shows the badge for a passing attempt', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 3, modulesToReview: [] }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
  });

  test('lists the modules to review', async () => {
    renderPage();

    const heading = await screen.findByText('Modules to review');
    // "Module 2" also appears as the tag on the missed question, so scope the
    // assertion to the summary block.
    const block = heading.closest('.modules-block');
    expect(block).not.toBeNull();
    expect(within(block as HTMLElement).getByText('Module 2')).toBeInTheDocument();
  });

  test('expands a missed question with the correct answer and explanation', async () => {
    renderPage();
    await screen.findByText(/not there yet/);

    // Question 2 is the missed one in the fixture.
    expect(screen.getByText(/✕ 2\. Question 2 prompt\?/)).toBeInTheDocument();
    expect(screen.getByText(/You chose/)).toHaveTextContent('Answer B for 2');
    expect(screen.getByText(/Correct is/)).toHaveTextContent('Answer A for 2');
    expect(screen.getByText('Because of reason 2.')).toBeInTheDocument();
  });

  test('collapses correct questions, revealing the explanation on click', async () => {
    renderPage();
    await screen.findByText(/not there yet/);

    expect(screen.queryByText('Because of reason 1.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /✓ 1\. Question 1 prompt\?/ }));
    expect(screen.getByText('Because of reason 1.')).toBeInTheDocument();
  });

  test('marks a blank answer as left blank rather than a wrong choice', async () => {
    const attempt = makeGradedAttempt();
    attempt.questions[1]!.selectedOptionId = null;
    getAttempt.mockResolvedValue({ attempt });
    renderPage();

    expect(await screen.findByText('You left this blank')).toBeInTheDocument();
  });

  test('offers retake and back links', async () => {
    renderPage();

    const retake = await screen.findByRole('link', { name: 'Retake quiz' });
    expect(retake).toHaveAttribute('href', `/courses/${SLUG}/quiz`);
    // Must land on the subject's quiz list, which shows scores and pass
    // badges. /courses only redirects to the subject *index*, which lists no
    // quizzes at all, so a pass was invisible from here.
    expect(screen.getByRole('link', { name: 'Back to quizzes' })).toHaveAttribute(
      'href',
      '/subjects/chassis',
    );
  });

  test('rejects an attempt that has not been submitted', async () => {
    getAttempt.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        courseId: 'course-1',
        startedAt: '2026-11-02T12:00:00.000Z',
        submittedAt: null,
        answers: [],
      },
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('has not been submitted yet'),
    );
  });

  test("reports another user's attempt as not found", async () => {
    getAttempt.mockRejectedValue(new ApiError('Attempt not found', 404));
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Attempt not found'),
    );
  });
});

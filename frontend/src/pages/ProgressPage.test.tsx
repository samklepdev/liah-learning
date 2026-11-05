import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { makeProgressRow } from '../test/fixtures';
import { ProgressPage } from './ProgressPage';

const getMyProgress = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getMyProgress: () => getMyProgress() },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProgressPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMyProgress.mockReset();
});

describe('ProgressPage', () => {
  test('shows an empty state when nothing has been completed', async () => {
    getMyProgress.mockResolvedValue({ courses: [] });
    renderPage();
    expect(
      await screen.findByText("You haven't completed any quizzes yet."),
    ).toBeInTheDocument();
  });

  test('lists best score, attempts, and links to the most recent result', async () => {
    getMyProgress.mockResolvedValue({
      courses: [makeProgressRow({ bestScore: 8, attemptCount: 2, lastAttemptId: 'attempt-9' })],
    });
    renderPage();

    expect(await screen.findByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute(
      'href',
      '/courses/chassis-tire-and-rim-essentials/results/attempt-9',
    );
  });

  test('shows an error message when the fetch fails', async () => {
    getMyProgress.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});

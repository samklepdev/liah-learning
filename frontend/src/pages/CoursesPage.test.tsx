import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { makeCourse } from '../test/fixtures';
import { ApiError } from '../quiz/api';
import { CoursesPage } from './CoursesPage';

const listCourses = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return { ...actual, quizApi: { ...actual.quizApi, listCourses: (s: string) => listCourses(s) } };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CoursesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listCourses.mockResolvedValue({ courses: [makeCourse()] });
});

describe('CoursesPage', () => {
  test('lists courses and links to their quiz', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute('href', '/courses/chassis-tire-and-rim-essentials/quiz');
    expect(screen.getByText('Course 1')).toBeInTheDocument();
  });

  test('shows "Not attempted" when there is no score yet', async () => {
    renderPage();
    expect(await screen.findByText('Not attempted')).toBeInTheDocument();
  });

  test('shows the best score, flagged as below target', async () => {
    listCourses.mockResolvedValue({
      courses: [makeCourse({ bestScore: 7, attemptCount: 2 })],
    });
    renderPage();

    const score = await screen.findByText(/Best 7\/10/);
    expect(score).toHaveTextContent('2 attempts');
    expect(score).toHaveClass('course-below');
  });

  test('flags a score at or above the target as passed', async () => {
    listCourses.mockResolvedValue({
      courses: [makeCourse({ bestScore: 9, attemptCount: 1 })],
    });
    renderPage();

    const score = await screen.findByText(/Best 9\/10/);
    expect(score).toHaveClass('course-passed');
    // A single attempt should not read "1 attempts".
    expect(score).not.toHaveTextContent('attempts');
  });

  test('reports a load failure', async () => {
    listCourses.mockRejectedValue(new ApiError('Subject not found', 404));
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Subject not found'),
    );
  });
});

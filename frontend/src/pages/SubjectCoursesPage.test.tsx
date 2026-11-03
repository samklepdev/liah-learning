import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeCourse } from '../test/fixtures';
import type { SubjectSummary } from '../quiz/api';
import { SubjectCoursesPage } from './SubjectCoursesPage';

const listCourses = vi.fn();
const subjects: SubjectSummary[] = [
  { id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 },
];

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, listCourses: (s: string) => listCourses(s) },
  };
});

// Supplies the Outlet context the page reads, without the layout's own fetch.
vi.mock('../quiz/useCatalog', () => ({ useCatalog: () => ({ subjects }) }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/subjects/chassis']}>
      <Routes>
        <Route path="/subjects/:subjectSlug" element={<SubjectCoursesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listCourses.mockResolvedValue({ courses: [makeCourse()] });
});

describe('SubjectCoursesPage', () => {
  test('labels each row as a numbered quiz', async () => {
    renderPage();
    expect(await screen.findByText('Quiz 1')).toBeInTheDocument();
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
});

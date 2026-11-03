import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeCourse } from '../test/fixtures';
import { ApiError, type SubjectSummary } from '../quiz/api';
import { CatalogLayout } from './CatalogLayout';
import { SubjectCoursesPage, SubjectsIndexPage } from './SubjectCoursesPage';

const listSubjects = vi.fn();
const listCourses = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: {
      ...actual.quizApi,
      listSubjects: () => listSubjects(),
      listCourses: (s: string) => listCourses(s),
    },
  };
});

const subjects: SubjectSummary[] = [
  { id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 },
  { id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/subjects" element={<CatalogLayout />}>
          <Route index element={<SubjectsIndexPage />} />
          <Route path=":subjectSlug" element={<SubjectCoursesPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listSubjects.mockResolvedValue({ subjects });
  listCourses.mockResolvedValue({
    courses: [makeCourse(), makeCourse({ id: 'c2', slug: 'chassis-two', title: 'Second', position: 2 })],
  });
});

describe('CatalogLayout', () => {
  test('lists every subject in the sidebar with its course count', async () => {
    renderAt('/subjects');

    const sidebar = await screen.findByRole('navigation', { name: 'Subjects' });
    expect(within(sidebar).getByRole('link', { name: /Chassis/ })).toHaveAttribute(
      'href',
      '/subjects/chassis',
    );
    expect(within(sidebar).getByRole('link', { name: /Engine/ })).toBeInTheDocument();
    expect(within(sidebar).getByText('11')).toBeInTheDocument();
    expect(within(sidebar).getByText('9')).toBeInTheDocument();
  });

  test('prompts for a selection before a subject is chosen', async () => {
    renderAt('/subjects');

    expect(await screen.findByRole('heading', { name: 'Choose a subject' })).toBeInTheDocument();
    expect(screen.getByText(/2 subjects available/)).toBeInTheDocument();
    expect(listCourses).not.toHaveBeenCalled();
  });

  test('shows the selected subject title and its quizzes', async () => {
    renderAt('/subjects/chassis');

    expect(await screen.findByRole('heading', { name: 'Chassis' })).toBeInTheDocument();
    expect(screen.getByText(/2 quizzes, one per course/)).toBeInTheDocument();
    expect(listCourses).toHaveBeenCalledWith('chassis');
    expect(screen.getByRole('link', { name: 'Tire and Rim Essentials' })).toHaveAttribute(
      'href',
      '/courses/chassis-tire-and-rim-essentials/quiz',
    );
  });

  test('marks the selected subject active in the sidebar', async () => {
    renderAt('/subjects/engine');

    const sidebar = await screen.findByRole('navigation', { name: 'Subjects' });
    expect(within(sidebar).getByRole('link', { name: /Engine/ })).toHaveClass('active');
    expect(within(sidebar).getByRole('link', { name: /Chassis/ })).not.toHaveClass('active');
  });

  test('switching subject refetches courses without refetching subjects', async () => {
    renderAt('/subjects/chassis');
    await screen.findByRole('heading', { name: 'Chassis' });
    expect(listSubjects).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('link', { name: /Engine/ }));

    await waitFor(() => expect(listCourses).toHaveBeenCalledWith('engine'));
    // The sidebar is fetched once by the layout, not per subject.
    expect(listSubjects).toHaveBeenCalledTimes(1);
  });

  test('uses the singular when a subject has one quiz', async () => {
    listCourses.mockResolvedValue({ courses: [makeCourse()] });
    renderAt('/subjects/chassis');

    expect(await screen.findByText(/1 quiz, one per course/)).toBeInTheDocument();
  });

  test('reports a failure to load subjects', async () => {
    listSubjects.mockRejectedValue(new ApiError('down', 500));
    renderAt('/subjects');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('down'));
  });

  test('reports a failure to load one subject without losing the sidebar', async () => {
    listCourses.mockRejectedValue(new ApiError('Subject not found', 404));
    renderAt('/subjects/nope');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Subject not found'),
    );
    expect(screen.getByRole('navigation', { name: 'Subjects' })).toBeInTheDocument();
  });
});

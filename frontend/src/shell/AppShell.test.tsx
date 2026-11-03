import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiError, type SubjectSummary } from '../quiz/api';
import { AppShell } from './AppShell';

const listSubjects = vi.fn();
const logout = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, listSubjects: () => listSubjects() },
  };
});

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'tech@example.com', createdAt: '2026-11-02T12:00:00.000Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout,
  }),
}));

const subjects: SubjectSummary[] = [
  { id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 },
  { id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 },
];

function renderAt(path = '/subjects') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/subjects" element={<div>SUBJECTS CONTENT</div>} />
          {/* Needed: the shell is a pathless layout route, so if no child
              matches it unmounts entirely along with the sidebar. */}
          <Route path="/subjects/:subjectSlug" element={<div>SUBJECT CONTENT</div>} />
          <Route path="/courses/:slug/quiz" element={<div>QUIZ CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listSubjects.mockResolvedValue({ subjects });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('AppShell', () => {
  test('renders the sidebar with every subject', async () => {
    renderAt();

    const nav = await screen.findByRole('navigation', { name: 'Subjects' });
    expect(within(nav).getByRole('link', { name: /Chassis/ })).toHaveAttribute(
      'href',
      '/subjects/chassis',
    );
    expect(within(nav).getByRole('link', { name: /Engine/ })).toBeInTheDocument();
  });

  test('starts open, and the toggle collapses it', async () => {
    renderAt();
    await screen.findByRole('navigation', { name: 'Subjects' });

    const toggle = screen.getByRole('button', { name: 'Close sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);

    // Hidden from the accessibility tree, not just visually.
    expect(screen.queryByRole('navigation', { name: 'Subjects' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('collapsing then expanding brings the sidebar back', async () => {
    renderAt();
    await screen.findByRole('navigation', { name: 'Subjects' });

    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    expect(screen.getByRole('navigation', { name: 'Subjects' })).toBeInTheDocument();
  });

  test('remembers the collapsed state across a remount', async () => {
    const first = renderAt();
    await screen.findByRole('navigation', { name: 'Subjects' });
    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    first.unmount();

    renderAt();

    // No flash of an open sidebar: the initial state is read from storage.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('navigation', { name: 'Subjects' })).not.toBeInTheDocument();
  });

  test('the content keeps rendering while the sidebar is collapsed', async () => {
    renderAt();
    await screen.findByText('SUBJECTS CONTENT');

    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));

    expect(screen.getByText('SUBJECTS CONTENT')).toBeInTheDocument();
  });

  test('the sidebar is present while taking a quiz', async () => {
    renderAt('/courses/chassis-tire-and-rim-essentials/quiz');

    expect(await screen.findByText('QUIZ CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Subjects' })).toBeInTheDocument();
  });

  test('selecting a subject closes the sidebar, for the mobile drawer case', async () => {
    renderAt();
    const nav = await screen.findByRole('navigation', { name: 'Subjects' });

    await userEvent.click(within(nav).getByRole('link', { name: /Engine/ }));

    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
  });

  test('shows the signed-in user and can sign out', async () => {
    renderAt();
    await screen.findByText('tech@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  test('a subject-load failure is reported without breaking the page', async () => {
    listSubjects.mockRejectedValue(new ApiError('subjects down', 500));
    renderAt();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('subjects down'),
    );
    // The routed content must still render.
    expect(screen.getByText('SUBJECTS CONTENT')).toBeInTheDocument();
  });

  test('handles having no subjects imported yet', async () => {
    listSubjects.mockResolvedValue({ subjects: [] });
    renderAt();

    expect(await screen.findByText('No subjects imported yet.')).toBeInTheDocument();
  });
});

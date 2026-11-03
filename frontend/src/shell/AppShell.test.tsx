import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeCourse } from '../test/fixtures';
import { ApiError, type SubjectSummary } from '../quiz/api';
import { AppShell } from './AppShell';

const listSubjects = vi.fn();
const listCourses = vi.fn();
const logout = vi.fn();

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
          {/* The shell is a pathless layout route: if no child matches it
              unmounts entirely, sidebar included. */}
          <Route path="/subjects/:subjectSlug" element={<div>SUBJECT CONTENT</div>} />
          <Route path="/courses/:slug/quiz" element={<div>QUIZ CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const nav = () => screen.findByRole('navigation', { name: 'Subjects' });

beforeEach(() => {
  listSubjects.mockResolvedValue({ subjects });
  listCourses.mockResolvedValue({
    courses: [
      makeCourse(),
      makeCourse({ id: 'c2', slug: 'chassis-fitment', title: 'Tire Fitment', position: 2 }),
    ],
  });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('AppShell — top navbar', () => {
  test('shows the brand, the signed-in user, and can sign out', async () => {
    renderAt();
    await nav();

    expect(screen.getByRole('link', { name: /LIAH Learning/ })).toHaveAttribute(
      'href',
      '/subjects',
    );
    // Identity shows once, in the sidebar footer — not duplicated in the navbar.
    const sidebar = await nav();
    expect(within(sidebar).getByText('tech@example.com')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });
});

describe('AppShell — theme toggle', () => {
  test('cycles light, dark, system and applies it to the document', async () => {
    renderAt();
    await nav();

    // Starts on system, since nothing is stored.
    const button = screen.getByRole('button', { name: /^Theme: System/ });
    expect(document.documentElement.dataset.theme).toBe('light');

    await userEvent.click(button);
    expect(screen.getByRole('button', { name: /^Theme: Light/ })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');

    await userEvent.click(screen.getByRole('button', { name: /^Theme: Light/ }));
    expect(screen.getByRole('button', { name: /^Theme: Dark/ })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: /^Theme: Dark/ }));
    expect(screen.getByRole('button', { name: /^Theme: System/ })).toBeInTheDocument();
  });

  test('a chosen theme survives a remount', async () => {
    const first = renderAt();
    await nav();
    await userEvent.click(screen.getByRole('button', { name: /^Theme: System/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Theme: Light/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    first.unmount();

    renderAt();
    expect(
      await screen.findByRole('button', { name: /^Theme: Dark/ }),
    ).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('AppShell — collapse', () => {
  test('starts open and the toggle collapses it', async () => {
    renderAt();
    await nav();

    const toggle = screen.getByRole('button', { name: 'Close sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);

    // Gone from the accessibility tree, not merely hidden visually.
    expect(screen.queryByRole('navigation', { name: 'Subjects' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('remembers the collapsed state across a remount', async () => {
    const first = renderAt();
    await nav();
    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    first.unmount();

    renderAt();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('navigation', { name: 'Subjects' })).not.toBeInTheDocument();
  });

  test('content keeps rendering while collapsed', async () => {
    renderAt();
    await screen.findByText('SUBJECTS CONTENT');

    await userEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(screen.getByText('SUBJECTS CONTENT')).toBeInTheDocument();
  });

  test('the sidebar is available while taking a quiz', async () => {
    renderAt('/courses/chassis-tire-and-rim-essentials/quiz');

    expect(await screen.findByText('QUIZ CONTENT')).toBeInTheDocument();
    expect(await nav()).toBeInTheDocument();
  });
});

describe('AppShell — subject disclosure', () => {
  test('lists each subject collapsed, with its quiz count', async () => {
    renderAt();
    const sidebar = await nav();

    const chassis = within(sidebar).getByRole('button', { name: /Chassis/ });
    expect(chassis).toHaveAttribute('aria-expanded', 'false');
    expect(within(sidebar).getByRole('button', { name: /Engine/ })).toBeInTheDocument();
    expect(within(chassis).getByText('11')).toBeInTheDocument();

    // Nothing fetched until a group is opened.
    expect(listCourses).not.toHaveBeenCalled();
  });

  test('expanding a subject loads and lists its quizzes', async () => {
    renderAt();
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Chassis/ }));

    expect(within(sidebar).getByRole('button', { name: /Chassis/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await waitFor(() => expect(listCourses).toHaveBeenCalledWith('chassis'));

    const link = await within(sidebar).findByRole('link', {
      name: /Tire and Rim Essentials/,
    });
    expect(link).toHaveAttribute('href', '/courses/chassis-tire-and-rim-essentials/quiz');
    expect(
      within(sidebar).getByRole('link', { name: /Tire Fitment/ }),
    ).toBeInTheDocument();
  });

  test('collapsing then reopening does not refetch the quizzes', async () => {
    renderAt();
    const sidebar = await nav();
    const button = within(sidebar).getByRole('button', { name: /Chassis/ });

    await userEvent.click(button);
    await waitFor(() => expect(listCourses).toHaveBeenCalledTimes(1));
    await userEvent.click(button);
    await userEvent.click(button);

    await within(sidebar).findByRole('link', { name: /Tire and Rim Essentials/ });
    expect(listCourses).toHaveBeenCalledTimes(1);
  });

  test('the subject you are viewing starts expanded', async () => {
    renderAt('/subjects/engine');
    const sidebar = await nav();

    expect(within(sidebar).getByRole('button', { name: /Engine/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(sidebar).getByRole('button', { name: /Chassis/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await waitFor(() => expect(listCourses).toHaveBeenCalledWith('engine'));
  });

  test('the current subject can still be collapsed by hand', async () => {
    renderAt('/subjects/engine');
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Engine/ }));

    expect(within(sidebar).getByRole('button', { name: /Engine/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('ticks the quizzes you have passed', async () => {
    listCourses.mockResolvedValue({
      courses: [
        makeCourse({ bestScore: 9 }),
        makeCourse({ id: 'c2', slug: 'chassis-fitment', title: 'Tire Fitment', position: 2 }),
      ],
    });
    renderAt();
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Chassis/ }));

    // One tick, on the passed quiz only. Labelled, so it is not a
    // glyph-and-colour-only signal.
    const ticks = await within(sidebar).findAllByRole('img', { name: 'Passed' });
    expect(ticks).toHaveLength(1);
    expect(
      within(sidebar).getByRole('link', { name: /Tire and Rim Essentials/ }),
    ).toContainElement(ticks[0]!);
  });

  test('a subject with no quizzes says so rather than spinning', async () => {
    listCourses.mockResolvedValue({ courses: [] });
    renderAt();
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Chassis/ }));

    expect(await within(sidebar).findByText('No quizzes yet')).toBeInTheDocument();
  });

  test('a failed quiz fetch also resolves, so the group does not spin forever', async () => {
    listCourses.mockRejectedValue(new ApiError('boom', 500));
    renderAt();
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Chassis/ }));

    expect(await within(sidebar).findByText('No quizzes yet')).toBeInTheDocument();
  });

  test('links to all subjects', async () => {
    renderAt();
    const sidebar = await nav();

    expect(within(sidebar).getByRole('link', { name: 'All subjects' })).toHaveAttribute(
      'href',
      '/subjects',
    );
  });

  test('reports a subject-load failure without breaking the page', async () => {
    listSubjects.mockRejectedValue(new ApiError('subjects down', 500));
    renderAt();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('subjects down'));
    expect(screen.getByText('SUBJECTS CONTENT')).toBeInTheDocument();
  });

  test('handles having no subjects imported yet', async () => {
    listSubjects.mockResolvedValue({ subjects: [] });
    renderAt();

    expect(await screen.findByText('No subjects imported yet')).toBeInTheDocument();
  });
});

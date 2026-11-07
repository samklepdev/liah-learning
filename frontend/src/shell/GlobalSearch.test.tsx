import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { GlobalSearch } from './GlobalSearch';

const search = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, search: (q: string) => search(q) },
  };
});

function renderAt(path = '/subjects') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/subjects" element={<GlobalSearch />} />
        <Route path="/subjects/:slug" element={<div>SUBJECT PAGE</div>} />
        <Route path="/courses/:slug/quiz" element={<div>QUIZ PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = () => screen.getByRole('combobox', { name: 'Search subjects and quizzes' });

beforeEach(() => {
  search.mockResolvedValue({
    subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
    courses: [
      {
        id: 'c1',
        slug: 'chassis-tire-and-rim-essentials',
        title: 'Tire and Rim Essentials',
        position: 1,
        passScore: 9,
        questionCount: 10,
        bestScore: null,
        attemptCount: 0,
        subjectSlug: 'chassis',
        subjectTitle: 'Chassis',
      },
    ],
  });
});

describe('GlobalSearch', () => {
  test('typing shows matching subjects and quizzes', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    expect(await screen.findByRole('option', { name: /^Chassis$/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Tire and Rim Essentials/ })).toBeInTheDocument();
  });

  test('a one-character query shows no dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'c');

    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('clicking a subject result navigates to the subject page', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    await userEvent.click(await screen.findByRole('option', { name: /^Chassis$/ }));

    expect(await screen.findByText('SUBJECT PAGE')).toBeInTheDocument();
  });

  test('clicking a quiz result navigates straight into the quiz', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    await userEvent.click(await screen.findByRole('option', { name: /Tire and Rim Essentials/ }));

    expect(await screen.findByText('QUIZ PAGE')).toBeInTheDocument();
  });

  test('arrow keys move the highlighted option and Enter navigates it', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /^Chassis$/ });

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(await screen.findByText('QUIZ PAGE')).toBeInTheDocument();
  });

  test('Escape closes the dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /^Chassis$/ });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('no matches shows a message instead of an empty panel', async () => {
    search.mockResolvedValue({ subjects: [], courses: [] });
    renderAt();
    await userEvent.type(input(), 'zzz');

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  test('clicking outside closes the dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /^Chassis$/ });

    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttemptsTable } from './AttemptsTable';
import type { AdminAttempt } from '../../admin/api';

const completed: AdminAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
  answeredCount: 10,
};

const inProgress: AdminAttempt = {
  id: 'a2',
  courseTitle: 'Water Safety',
  courseSlug: 'water-safety',
  subjectSlug: 'first-aid',
  score: null,
  startedAt: '2026-10-02T00:00:00Z',
  submittedAt: null,
  answeredCount: 3,
};

const notStarted: AdminAttempt = {
  id: 'a3',
  courseTitle: 'Fire Safety',
  courseSlug: 'fire-safety',
  subjectSlug: 'first-aid',
  score: null,
  startedAt: '2026-10-03T00:00:00Z',
  submittedAt: null,
  answeredCount: 0,
};

describe('AttemptsTable', () => {
  test('renders a row per attempt with subject, course, score, status, and date', () => {
    render(<AttemptsTable attempts={[completed, inProgress]} />);

    expect(screen.getByText('CPR Basics')).toBeInTheDocument();
    expect(screen.getByText('Water Safety')).toBeInTheDocument();
    expect(screen.getAllByText('first-aid')).toHaveLength(2);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-10-01T01:00:00Z').toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-10-02T00:00:00Z').toLocaleDateString())).toBeInTheDocument();
  });

  test('shows a dash for score when the attempt has not been submitted', () => {
    render(<AttemptsTable attempts={[inProgress]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('shows "Not started" for an open attempt with no saved answers', () => {
    render(<AttemptsTable attempts={[notStarted]} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });
});

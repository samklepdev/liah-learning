import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserAttemptsModal } from './UserAttemptsModal';
import type { AdminAttempt } from '../../admin/api';

const attempt: AdminAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
  answeredCount: 10,
};

describe('UserAttemptsModal', () => {
  test('renders the full attempt list and the user label', () => {
    render(
      <UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
    expect(screen.getByText('CPR Basics')).toBeInTheDocument();
  });

  test('clicking the close button calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking the overlay calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('admin-modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the modal panel does not call onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByText('CPR Basics'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('pressing Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

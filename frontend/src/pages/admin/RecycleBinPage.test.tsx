import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RecycleBinPage } from './RecycleBinPage';

const listDeletedUsers = vi.fn();
const restoreUser = vi.fn();
const listDeletedCourses = vi.fn();
const restoreCourse = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listDeletedUsers: (page: number) => listDeletedUsers(page),
    restoreUser: (id: string) => restoreUser(id),
    listDeletedCourses: () => listDeletedCourses(),
    restoreCourse: (id: string) => restoreCourse(id),
  },
}));

beforeEach(() => {
  listDeletedUsers.mockResolvedValue({
    items: [
      {
        id: 'u1',
        username: 'gonezo',
        firstName: 'Gone',
        lastName: 'Zo',
        role: 'user',
        mustChangePassword: false,
        createdAt: '2026-11-01T00:00:00Z',
        isActive: false,
        deletedAt: '2026-11-05T00:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  restoreUser.mockResolvedValue({ user: {} });
  listDeletedCourses.mockResolvedValue({
    items: [
      {
        id: 'c1',
        slug: 'chassis-tire-and-rim-essentials',
        title: 'Tire and Rim Essentials',
        position: 1,
        passScore: 9,
        questionCount: 10,
        subjectSlug: 'chassis',
        subjectTitle: 'Chassis',
        isActive: false,
        deletedAt: '2026-11-05T00:00:00Z',
      },
    ],
  });
  restoreCourse.mockResolvedValue({ course: {} });
});

describe('RecycleBinPage', () => {
  test('shows deleted users by default', async () => {
    render(<RecycleBinPage />);
    expect(await screen.findByText('gonezo')).toBeInTheDocument();
  });

  test('restoring a user calls restoreUser and removes the row', async () => {
    render(<RecycleBinPage />);
    await screen.findByText('gonezo');
    const row = screen.getByText('gonezo').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreUser).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('gonezo')).not.toBeInTheDocument());
  });

  test('switching to the Courses tab loads deleted courses', async () => {
    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deleted Courses' }));
    expect(await screen.findByText('Tire and Rim Essentials')).toBeInTheDocument();
  });

  test('restoring a course calls restoreCourse and removes the row', async () => {
    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deleted Courses' }));
    await screen.findByText('Tire and Rim Essentials');
    const row = screen.getByText('Tire and Rim Essentials').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreCourse).toHaveBeenCalledWith('c1'));
    await waitFor(() =>
      expect(screen.queryByText('Tire and Rim Essentials')).not.toBeInTheDocument(),
    );
  });
});

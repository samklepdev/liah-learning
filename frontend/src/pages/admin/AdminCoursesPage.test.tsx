import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminCoursesPage } from './AdminCoursesPage';

const listCourses = vi.fn();
const deleteCourse = vi.fn();
const parseImport = vi.fn();
const confirmImport = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listCourses: () => listCourses(),
    deleteCourse: (id: string) => deleteCourse(id),
    parseImport: (file: File, title: string) => parseImport(file, title),
    confirmImport: (subject: unknown) => confirmImport(subject),
  },
}));

beforeEach(() => {
  listCourses.mockResolvedValue({
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
        isActive: true,
        deletedAt: null,
      },
    ],
  });
  deleteCourse.mockResolvedValue(undefined);
});

describe('AdminCoursesPage', () => {
  test('lists every course with its subject', async () => {
    render(<AdminCoursesPage />);
    expect(await screen.findByText('Tire and Rim Essentials')).toBeInTheDocument();
    expect(screen.getByText('Chassis')).toBeInTheDocument();
  });

  test('deleting a course calls deleteCourse and removes the row', async () => {
    render(<AdminCoursesPage />);
    await screen.findByText('Tire and Rim Essentials');
    const row = screen.getByText('Tire and Rim Essentials').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteCourse).toHaveBeenCalledWith('c1'));
    await waitFor(() =>
      expect(screen.queryByText('Tire and Rim Essentials')).not.toBeInTheDocument(),
    );
  });

  test('clicking Import quiz pack opens the import modal', async () => {
    render(<AdminCoursesPage />);
    await screen.findByText('Tire and Rim Essentials');
    fireEvent.click(screen.getByRole('button', { name: /import quiz pack/i }));

    expect(screen.getByText('Import quiz content')).toBeInTheDocument();
  });
});

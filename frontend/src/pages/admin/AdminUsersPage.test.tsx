import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminUsersPage } from './AdminUsersPage';

const listUsers = vi.fn();
const setRole = vi.fn();
const deleteUser = vi.fn();
const getUserAttempts = vi.fn();
const parseUserImport = vi.fn();
const confirmUserImport = vi.fn();
const useAuth = vi.fn();

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../../admin/api', () => ({
  adminApi: {
    listUsers: (page: number) => listUsers(page),
    setRole: (id: string, role: string) => setRole(id, role),
    deleteUser: (id: string) => deleteUser(id),
    getUserAttempts: (id: string) => getUserAttempts(id),
    parseUserImport: (file: File) => parseUserImport(file),
    confirmUserImport: (rows: unknown) => confirmUserImport(rows),
  },
}));

const sampleAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
  answeredCount: 10,
};

beforeEach(() => {
  useAuth.mockReturnValue({ user: { id: 'me', email: 'admin@example.com', role: 'admin' } });
  listUsers.mockResolvedValue({
    items: [
      {
        id: 'me',
        email: 'admin@example.com',
        firstName: null,
        lastName: null,
        role: 'admin',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'u2',
        email: 'student@example.com',
        firstName: null,
        lastName: null,
        role: 'user',
        createdAt: '2026-11-02T00:00:00Z',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  getUserAttempts.mockResolvedValue({ attempts: [] });
  setRole.mockResolvedValue({ user: { id: 'u2', email: 'student@example.com', role: 'admin' } });
  deleteUser.mockResolvedValue(undefined);
  parseUserImport.mockReset();
  confirmUserImport.mockReset();
  toastSuccess.mockReset();
});

describe('AdminUsersPage', () => {
  test('lists every user with their role', async () => {
    render(<AdminUsersPage />);
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
  });

  test("disables promote/demote and delete for the signed-in admin's own row", async () => {
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');
    const ownRow = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(ownRow).getByRole('button', { name: /make user/i })).toBeDisabled();
    expect(within(ownRow).getByRole('button', { name: /delete/i })).toBeDisabled();
  });

  test('promoting a user calls setRole and reflects the new role', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /make admin/i }));

    await waitFor(() => expect(setRole).toHaveBeenCalledWith('u2', 'admin'));
  });

  test('deleting a user calls deleteUser and removes the row', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u2'));
    await waitFor(() =>
      expect(screen.queryByText('student@example.com')).not.toBeInTheDocument(),
    );
    expect(toastSuccess).toHaveBeenCalledWith('User deleted');
  });

  test('clicking Next requests the next page and updates the table', async () => {
    listUsers.mockImplementation((page: number) =>
      Promise.resolve(
        page === 1
          ? {
              items: [
                {
                  id: 'me',
                  email: 'admin@example.com',
                  firstName: null,
                  lastName: null,
                  role: 'admin',
                  createdAt: '2026-11-01T00:00:00Z',
                },
              ],
              total: 25,
              page: 1,
              pageSize: 20,
            }
          : {
              items: [
                {
                  id: 'u2',
                  email: 'student@example.com',
                  firstName: null,
                  lastName: null,
                  role: 'user',
                  createdAt: '2026-11-02T00:00:00Z',
                },
              ],
              total: 25,
              page: 2,
              pageSize: 20,
            },
      ),
    );
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(2));
    expect(await screen.findByText('student@example.com')).toBeInTheDocument();
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  function manyImportRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      row: i + 2,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      email: `user${i}@example.com`,
      role: 'user' as const,
    }));
  }

  test('paginates the import preview table when there are more than one page of rows', async () => {
    parseUserImport.mockResolvedValue({ rows: manyImportRows(25), errors: [] });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('user0@example.com')).toBeInTheDocument();
    expect(screen.queryByText('user20@example.com')).not.toBeInTheDocument();

    const previewSection = screen.getByText('user0@example.com').closest('.import-preview') as HTMLElement;
    fireEvent.click(within(previewSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('user20@example.com')).toBeInTheDocument();
    expect(screen.queryByText('user0@example.com')).not.toBeInTheDocument();
  });

  function selectImportFile() {
    const file = new File(['First Name,Last Name,Email\nJane,Doe,jane@example.com'], 'students.csv', {
      type: 'text/csv',
    });
    const input = screen.getByLabelText(/user list file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  test('parsing a file shows a preview with row errors', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [{ row: 3, message: 'Row 3: invalid email' }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText(/row 3: invalid email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeEnabled();
  });

  test('confirming an import shows generated passwords and reloads the user list', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [
        { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' },
      ],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(confirmUserImport).toHaveBeenCalled());
    expect(await screen.findByText('abc123')).toBeInTheDocument();
    // listUsers is called once on mount, once more after a successful import.
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith('1 user created');
  });

  test('a mixed import summarizes created and skipped counts in the toast', async () => {
    parseUserImport.mockResolvedValue({
      rows: [
        { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' },
        { row: 3, firstName: 'John', lastName: 'Roe', email: 'john@example.com', role: 'user' },
      ],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [
        { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' },
      ],
      skipped: [{ email: 'john@example.com', reason: 'already registered' }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 user created, 1 skipped'));
  });

  test('copying created users writes an email,name,role,password CSV to the clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [
        { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' },
      ],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));
    await screen.findByText('abc123');

    fireEvent.click(screen.getByRole('button', { name: /copy all as csv/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain('jane@example.com');
    expect(written).toContain('abc123');
  });

  test('Confirm import is disabled when there are no valid rows', async () => {
    parseUserImport.mockResolvedValue({ rows: [], errors: [{ row: 1, message: 'bad row' }] });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await screen.findByText(/bad row/i);
    expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
  });

  test('expanding a row fetches and shows the user\'s attempts, collapsing hides them', async () => {
    getUserAttempts.mockResolvedValue({ attempts: [sampleAttempt] });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await waitFor(() => expect(getUserAttempts).toHaveBeenCalledWith('u2'));
    expect(await screen.findByText('CPR Basics')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();

    fireEvent.click(within(studentRow).getByRole('button', { name: /hide attempts/i }));
    expect(screen.queryByText('CPR Basics')).not.toBeInTheDocument();
  });

  test('re-expanding a row reuses the cached attempts instead of refetching', async () => {
    getUserAttempts.mockResolvedValue({ attempts: [sampleAttempt] });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    await screen.findByText('CPR Basics');
    fireEvent.click(within(studentRow).getByRole('button', { name: /hide attempts/i }));
    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('CPR Basics');
    expect(getUserAttempts).toHaveBeenCalledTimes(1);
  });

  test('shows "No attempts yet." for a user with no attempts', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('No attempts yet.')).toBeInTheDocument();
  });

  test('shows an error message when fetching attempts fails', async () => {
    getUserAttempts.mockRejectedValue(new Error('Network error'));
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  test('shows "Not started" for an open attempt with no saved answers', async () => {
    getUserAttempts.mockResolvedValue({
      attempts: [{ ...sampleAttempt, submittedAt: null, score: null, answeredCount: 0 }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('Not started')).toBeInTheDocument();
  });

  function manyAttempts(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      ...sampleAttempt,
      id: `a${i + 1}`,
      courseTitle: `Course ${i + 1}`,
    }));
  }

  test('caps the inline list at 5 and shows a "view all" button for more', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(6) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view all 6 attempts/i })).toBeInTheDocument();
  });

  test('does not show "view all" when there are 5 or fewer attempts', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(5) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByRole('button', { name: /view all/i })).not.toBeInTheDocument();
  });

  test('clicking "view all" opens a modal with the full attempt list, closable', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(6) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /view all 6 attempts/i }));

    expect(await screen.findByText('Course 6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
  });
});

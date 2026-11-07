import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminUsersPage } from './AdminUsersPage';

const listUsers = vi.fn();
const setRole = vi.fn();
const deleteUser = vi.fn();
const getUserAttempts = vi.fn();
const parseUserImport = vi.fn();
const confirmUserImport = vi.fn();
const createUser = vi.fn();
const resetPassword = vi.fn();
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
    createUser: (firstName: string, lastName: string, role: string) => createUser(firstName, lastName, role),
    resetPassword: (id: string) => resetPassword(id),
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
  useAuth.mockReturnValue({ user: { id: 'me', username: 'adminuser', role: 'admin' } });
  listUsers.mockResolvedValue({
    items: [
      {
        id: 'me',
        username: 'adminuser',
        firstName: null,
        lastName: null,
        role: 'admin',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'u2',
        username: 'student',
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
  setRole.mockResolvedValue({ user: { id: 'u2', username: 'student', role: 'admin' } });
  deleteUser.mockResolvedValue(undefined);
  parseUserImport.mockReset();
  confirmUserImport.mockReset();
  createUser.mockReset();
  resetPassword.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockReset();
});

describe('AdminUsersPage', () => {
  test('lists every user with their role', async () => {
    render(<AdminUsersPage />);
    expect(await screen.findByText('adminuser')).toBeInTheDocument();
    expect(screen.getByText('student')).toBeInTheDocument();
  });

  test('resetting a password calls the API and toasts a confirmation', async () => {
    render(<AdminUsersPage />);
    const row = (await screen.findByText('student')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('u2'));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Password reset — user must set a new one at next login.'),
    );
  });

  test('the reset-password action is disabled for your own row', async () => {
    render(<AdminUsersPage />);
    const row = (await screen.findByText('adminuser')).closest('tr')!;

    expect(within(row).getByRole('button', { name: 'Reset password' })).toBeDisabled();
  });

  test('labels each cell in the main users table for the mobile card layout', async () => {
    render(<AdminUsersPage />);
    const row = (await screen.findByText('student')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
      'Username',
      'First Name',
      'Last Name',
      'Role',
      'Joined',
      null,
    ]);
  });

  test("disables promote/demote and delete for the signed-in admin's own row", async () => {
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');
    const ownRow = screen.getByText('adminuser').closest('tr')!;
    expect(within(ownRow).getByRole('button', { name: /make user/i })).toBeDisabled();
    expect(within(ownRow).getByRole('button', { name: /delete/i })).toBeDisabled();
  });

  test('promoting a user calls setRole and reflects the new role', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /make admin/i }));

    await waitFor(() => expect(setRole).toHaveBeenCalledWith('u2', 'admin'));
  });

  test('deleting a user calls deleteUser and removes the row', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u2'));
    await waitFor(() => expect(screen.queryByText('student')).not.toBeInTheDocument());
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
                  username: 'adminuser',
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
                  username: 'student',
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
    await screen.findByText('adminuser');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(2));
    expect(await screen.findByText('student')).toBeInTheDocument();
    expect(screen.queryByText('adminuser')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  test('clicking "Add user" opens the add-user modal', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.click(screen.getByRole('button', { name: /^add user$/i }));

    expect(screen.getByRole('heading', { name: /add a user/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
  });

  test('creating a user via the modal closes it and refreshes the list', async () => {
    createUser.mockResolvedValue({
      user: { id: 'u3', username: 'njordan', firstName: 'New', lastName: 'Jordan', role: 'user', createdAt: '2026-11-06T00:00:00Z' },
    });
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.click(screen.getByRole('button', { name: /^add user$/i }));
    const modal = within(screen.getByTestId('admin-modal-overlay'));
    fireEvent.change(modal.getByLabelText(/first name/i), { target: { value: 'New' } });
    fireEvent.change(modal.getByLabelText(/last name/i), { target: { value: 'Jordan' } });
    fireEvent.click(modal.getByRole('button', { name: /create user/i }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith('New', 'Jordan', 'user'));
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /add a user/i })).not.toBeInTheDocument(),
    );
  });

  test('clicking "Seed users from a file" opens the import modal', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.click(screen.getByRole('button', { name: /seed users from a file/i }));

    expect(screen.getByRole('heading', { name: /seed users from a file/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/user list file/i)).toBeInTheDocument();
  });

  test('confirming an import refreshes the list but leaves the modal open', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.click(screen.getByRole('button', { name: /seed users from a file/i }));
    const file = new File(['First Name,Last Name\nJane,Doe'], 'students.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText(/user list file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: /seed users from a file/i })).toBeInTheDocument();
  });

  test('expanding a row fetches and shows the user\'s attempts, collapsing hides them', async () => {
    getUserAttempts.mockResolvedValue({ attempts: [sampleAttempt] });
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

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
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    await screen.findByText('CPR Basics');
    fireEvent.click(within(studentRow).getByRole('button', { name: /hide attempts/i }));
    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('CPR Basics');
    expect(getUserAttempts).toHaveBeenCalledTimes(1);
  });

  test('shows "No attempts yet." for a user with no attempts', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('No attempts yet.')).toBeInTheDocument();
  });

  test('shows an error message when fetching attempts fails', async () => {
    getUserAttempts.mockRejectedValue(new Error('Network error'));
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  test('shows "Not started" for an open attempt with no saved answers', async () => {
    getUserAttempts.mockResolvedValue({
      attempts: [{ ...sampleAttempt, submittedAt: null, score: null, answeredCount: 0 }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

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
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view all 6 attempts/i })).toBeInTheDocument();
  });

  test('does not show "view all" when there are 5 or fewer attempts', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(5) });
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByRole('button', { name: /view all/i })).not.toBeInTheDocument();
  });

  test('clicking "view all" opens a modal with the full attempt list, closable', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(6) });
    render(<AdminUsersPage />);
    await screen.findByText('student');
    const studentRow = screen.getByText('student').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /view all 6 attempts/i }));

    expect(await screen.findByText('Course 6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
  });
});

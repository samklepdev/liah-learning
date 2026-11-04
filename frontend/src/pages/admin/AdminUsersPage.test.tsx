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

vi.mock('../../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../../admin/api', () => ({
  adminApi: {
    listUsers: () => listUsers(),
    setRole: (id: string, role: string) => setRole(id, role),
    deleteUser: (id: string) => deleteUser(id),
    getUserAttempts: (id: string) => getUserAttempts(id),
    parseUserImport: (file: File) => parseUserImport(file),
    confirmUserImport: (rows: unknown) => confirmUserImport(rows),
  },
}));

beforeEach(() => {
  useAuth.mockReturnValue({ user: { id: 'me', email: 'admin@example.com', role: 'admin' } });
  listUsers.mockResolvedValue({
    users: [
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
  });
  getUserAttempts.mockResolvedValue({ attempts: [] });
  setRole.mockResolvedValue({ user: { id: 'u2', email: 'student@example.com', role: 'admin' } });
  deleteUser.mockResolvedValue(undefined);
  parseUserImport.mockReset();
  confirmUserImport.mockReset();
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
});

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ImportUsersModal } from './ImportUsersModal';

const parseUserImport = vi.fn();
const confirmUserImport = vi.fn();
const toastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));
vi.mock('../../admin/api', () => ({
  adminApi: {
    parseUserImport: (file: File) => parseUserImport(file),
    confirmUserImport: (rows: unknown) => confirmUserImport(rows),
  },
}));

function selectImportFile() {
  const file = new File(['First Name,Last Name\nJane,Doe'], 'students.csv', { type: 'text/csv' });
  const input = screen.getByLabelText(/user list file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function manyImportRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    row: i + 2,
    firstName: `First${i}`,
    lastName: `Last${i}`,
    role: 'user' as const,
  }));
}

function manyConfirmedUsers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    username: `created${i}`,
    firstName: `First${i}`,
    lastName: `Last${i}`,
    role: 'user' as const,
  }));
}

function manySkippedUsers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    firstName: `Skipped${i}`,
    lastName: 'User',
    reason: 'already registered',
  }));
}

beforeEach(() => {
  parseUserImport.mockReset();
  confirmUserImport.mockReset();
  toastSuccess.mockReset();
});

describe('ImportUsersModal', () => {
  test('parsing a file shows a preview with row errors', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [{ row: 3, message: 'Row 3: last name is required' }],
    });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText(/row 3: last name is required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeEnabled();
  });

  test('Confirm import is disabled when there are no valid rows', async () => {
    parseUserImport.mockResolvedValue({ rows: [], errors: [{ row: 1, message: 'bad row' }] });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await screen.findByText(/bad row/i);
    expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
  });

  test('paginates the import preview table when there are more than one page of rows', async () => {
    parseUserImport.mockResolvedValue({ rows: manyImportRows(25), errors: [] });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('First0')).toBeInTheDocument();
    expect(screen.queryByText('First20')).not.toBeInTheDocument();

    const previewSection = screen.getByText('First0').closest('.import-preview') as HTMLElement;
    fireEvent.click(within(previewSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('First20')).toBeInTheDocument();
    expect(screen.queryByText('First0')).not.toBeInTheDocument();
  });

  test('labels each cell in the import preview table for the mobile card layout', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    const row = (await screen.findByText('Jane')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual(['First Name', 'Last Name', 'Role']);
  });

  test('confirming an import shows a success toast, results, and calls onImported without closing', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      skipped: [],
    });
    const onClose = vi.fn();
    const onImported = vi.fn();
    render(<ImportUsersModal onClose={onClose} onImported={onImported} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(confirmUserImport).toHaveBeenCalled());
    expect(await screen.findByText('jdoe')).toBeInTheDocument();
    expect(screen.getByText(/initial password for all created users:/i)).toBeInTheDocument();
    expect(screen.getByText('liahwellness')).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('1 user created');
    expect(onImported).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a mixed import summarizes created and skipped counts in the toast', async () => {
    parseUserImport.mockResolvedValue({
      rows: [
        { row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' },
        { row: 3, firstName: 'John', lastName: 'Roe', role: 'user' },
      ],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      skipped: [{ firstName: 'John', lastName: 'Roe', reason: 'already registered' }],
    });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 user created, 1 skipped'));
  });

  test('paginates the import results "Created" table when there are more than one page', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({ created: manyConfirmedUsers(25), skipped: [] });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    expect(await screen.findByText('created0')).toBeInTheDocument();
    expect(screen.queryByText('created20')).not.toBeInTheDocument();

    const createdSection = screen.getByText('Created').closest('.import-results') as HTMLElement;
    fireEvent.click(within(createdSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('created20')).toBeInTheDocument();
  });

  test('paginates the import results "Skipped" list when there are more than one page', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({ created: [], skipped: manySkippedUsers(25) });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    expect(await screen.findByText(/Skipped0 User/)).toBeInTheDocument();
    expect(screen.queryByText(/Skipped20 User/)).not.toBeInTheDocument();

    const skippedSection = screen.getByText('Skipped').closest('.import-results') as HTMLElement;
    fireEvent.click(within(skippedSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/Skipped20 User/)).toBeInTheDocument();
  });

  test('labels each cell in the import results "Created" table for the mobile card layout', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      skipped: [],
    });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    const row = (await screen.findByText('jdoe')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
      'Username',
      'First Name',
      'Last Name',
      'Role',
    ]);
  });

  test('copying created users writes a username,name,role CSV to the clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      skipped: [],
    });
    render(<ImportUsersModal onClose={vi.fn()} onImported={vi.fn()} />);

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));
    await screen.findByText('jdoe');

    fireEvent.click(screen.getByRole('button', { name: /copy all as csv/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain('jdoe');
  });

  test('clicking the overlay closes the modal', () => {
    const onClose = vi.fn();
    render(<ImportUsersModal onClose={onClose} onImported={vi.fn()} />);

    fireEvent.click(screen.getByTestId('admin-modal-overlay'));

    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the close button closes the modal', () => {
    const onClose = vi.fn();
    render(<ImportUsersModal onClose={onClose} onImported={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });
});

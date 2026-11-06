import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportCoursesModal } from './ImportCoursesModal';

const parseImport = vi.fn();
const confirmImport = vi.fn();
const onClose = vi.fn();
const onImported = vi.fn();

vi.mock('../../admin/api', () => ({
  adminApi: {
    parseImport: (file: File, title: string) => parseImport(file, title),
    confirmImport: (subject: unknown) => confirmImport(subject),
  },
}));

function selectFile() {
  const file = new File(['pdf-bytes'], 'chassis.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText(/pdf file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  parseImport.mockReset();
  confirmImport.mockReset();
  onClose.mockReset();
  onImported.mockReset();
});

describe('ImportCoursesModal', () => {
  test('shows a summary and a Confirm button after a successful parse', async () => {
    parseImport.mockResolvedValue({
      subject: { slug: 'chassis' },
      summary: { courses: 11, questions: 110 },
    });
    render(<ImportCoursesModal onClose={onClose} onImported={onImported} />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Chassis' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText(/11 courses, 110 questions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeInTheDocument();
  });

  test('shows parser errors and no Confirm button on a bad pack', async () => {
    parseImport.mockResolvedValue({
      errors: ['Course 3: cover page declared 10 questions, found 9.'],
    });
    render(<ImportCoursesModal onClose={onClose} onImported={onImported} />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Bad' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText(/cover page declared 10 questions/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
  });

  test('clicking Confirm calls confirmImport and notifies the parent', async () => {
    parseImport.mockResolvedValue({
      subject: { slug: 'chassis' },
      summary: { courses: 11, questions: 110 },
    });
    confirmImport.mockResolvedValue({ courses: 11, questions: 110 });
    render(<ImportCoursesModal onClose={onClose} onImported={onImported} />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Chassis' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(confirmImport).toHaveBeenCalledWith({ slug: 'chassis' }));
    expect(await screen.findByText(/imported: 11 courses, 110 questions/i)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
  });

  test('clicking the overlay closes the modal', () => {
    render(<ImportCoursesModal onClose={onClose} onImported={onImported} />);
    fireEvent.click(screen.getByTestId('admin-modal-overlay'));
    expect(onClose).toHaveBeenCalled();
  });
});

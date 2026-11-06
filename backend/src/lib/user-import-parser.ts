import { read, utils } from 'xlsx';
import { z } from 'zod';
import { extractPdfText } from './pdf-text.ts';

export type Role = 'user' | 'admin';
export type ParsedUserRow = {
  row: number;
  firstName: string;
  lastName: string;
  role: Role;
};
export type RowError = { row: number; message: string };
export type ParseResult = { rows: ParsedUserRow[]; errors: RowError[] };

const rowSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  role: z.enum(['user', 'admin']).optional(),
});

/** Validates one raw {firstName, lastName, role} triple into a row or a row error. */
function validateRow(
  rowNumber: number,
  raw: { firstName: string; lastName: string; role: string },
): { row: ParsedUserRow } | { error: RowError } {
  const parsed = rowSchema.safeParse({
    firstName: raw.firstName.trim(),
    lastName: raw.lastName.trim(),
    role: raw.role.trim() === '' ? undefined : raw.role.trim().toLowerCase(),
  });

  if (!parsed.success) {
    return { error: { row: rowNumber, message: `Row ${rowNumber}: ${z.prettifyError(parsed.error)}` } };
  }

  return {
    row: {
      row: rowNumber,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role ?? 'user',
    },
  };
}

/** xlsx and csv both go through SheetJS, which reads both from a buffer. */
function parseSpreadsheet(buffer: Buffer): ParseResult {
  const workbook = read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { rows: [], errors: [{ row: 0, message: 'No sheet found in file.' }] };
  }

  // Keep blank rows in the array (default blankrows behavior) so row indices
  // stay aligned to physical spreadsheet position; skip them explicitly below
  // instead of letting SheetJS drop them before numbering is derived.
  const cellRows = utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const [header, ...dataRows] = cellRows;
  if (!header) {
    return { rows: [], errors: [{ row: 0, message: 'File has no header row.' }] };
  }

  const normalizedHeader = header.map((h) => String(h ?? '').trim().toLowerCase());
  const firstNameIdx = normalizedHeader.indexOf('first name');
  const lastNameIdx = normalizedHeader.indexOf('last name');
  const roleIdx = normalizedHeader.indexOf('role');
  if (firstNameIdx === -1) {
    return { rows: [], errors: [{ row: 0, message: 'File is missing a "First Name" column.' }] };
  }
  if (lastNameIdx === -1) {
    return { rows: [], errors: [{ row: 0, message: 'File is missing a "Last Name" column.' }] };
  }

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  dataRows.forEach((cells, i) => {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row
    const isBlank = cells.every((cell) => cell === undefined || cell === null || String(cell).trim() === '');
    if (isBlank) return;

    const firstName = String(cells[firstNameIdx] ?? '');
    const lastName = String(cells[lastNameIdx] ?? '');
    const role = roleIdx === -1 ? '' : String(cells[roleIdx] ?? '');
    const result = validateRow(rowNumber, { firstName, lastName, role });
    if ('error' in result) errors.push(result.error);
    else rows.push(result.row);
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: 'File has no data rows.' });
  }

  return { rows, errors };
}

/** PDF text (and the .txt fixtures that stand in for it in tests) has no
 *  header: every line is `First Name, Last Name, Role` with role optional. */
function parsePdfLines(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  lines.forEach((line, i) => {
    if (line === '') return;
    const rowNumber = i + 1;
    const cells = line.split(',').map((cell) => cell.trim());
    const [firstName = '', lastName = '', role = ''] = cells;
    const result = validateRow(rowNumber, { firstName, lastName, role });
    if ('error' in result) errors.push(result.error);
    else rows.push(result.row);
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: 'File has no data rows.' });
  }

  return { rows, errors };
}

export function parseUserRows(file: { buffer: Buffer; originalname: string }): ParseResult {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) {
    return parseSpreadsheet(file.buffer);
  }
  if (name.endsWith('.pdf')) {
    return parsePdfLines(extractPdfText(file.buffer));
  }
  if (name.endsWith('.txt')) {
    // Pre-extracted PDF text, used by tests to avoid a pdftotext/poppler
    // dependency in CI — same convention as admin-import.controller.ts.
    return parsePdfLines(file.buffer.toString('utf8'));
  }
  return { rows: [], errors: [{ row: 0, message: 'Unsupported file type. Upload .xlsx, .csv, or .pdf.' }] };
}

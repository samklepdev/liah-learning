import { read, utils } from 'xlsx';
import { z } from 'zod';
import { extractPdfText } from './pdf-text.ts';

export type Role = 'user' | 'admin';
export type ParsedUserRow = { row: number; name: string | null; email: string; role: Role };
export type RowError = { row: number; message: string };
export type ParseResult = { rows: ParsedUserRow[]; errors: RowError[] };

const rowSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(['user', 'admin']).optional(),
});

/** Validates one raw {name, email, role} triple into a row or a row error. */
function validateRow(
  rowNumber: number,
  raw: { name: string; email: string; role: string },
): { row: ParsedUserRow } | { error: RowError } {
  const parsed = rowSchema.safeParse({
    name: raw.name.trim() === '' ? undefined : raw.name,
    email: raw.email,
    role: raw.role.trim() === '' ? undefined : raw.role.trim().toLowerCase(),
  });

  if (!parsed.success) {
    return { error: { row: rowNumber, message: `Row ${rowNumber}: ${z.prettifyError(parsed.error)}` } };
  }

  return {
    row: {
      row: rowNumber,
      name: parsed.data.name ?? null,
      email: parsed.data.email,
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

  const cellRows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const [header, ...dataRows] = cellRows;
  if (!header) {
    return { rows: [], errors: [{ row: 0, message: 'File has no header row.' }] };
  }

  const normalizedHeader = header.map((h) => String(h ?? '').trim().toLowerCase());
  const nameIdx = normalizedHeader.indexOf('name');
  const emailIdx = normalizedHeader.indexOf('email');
  const roleIdx = normalizedHeader.indexOf('role');
  if (emailIdx === -1) {
    return { rows: [], errors: [{ row: 0, message: 'File is missing an "Email" column.' }] };
  }

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  dataRows.forEach((cells, i) => {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row
    const name = nameIdx === -1 ? '' : String(cells[nameIdx] ?? '');
    const email = String(cells[emailIdx] ?? '');
    const role = roleIdx === -1 ? '' : String(cells[roleIdx] ?? '');
    const result = validateRow(rowNumber, { name, email, role });
    if ('error' in result) errors.push(result.error);
    else rows.push(result.row);
  });

  return { rows, errors };
}

/** PDF text (and the .txt fixtures that stand in for it in tests) has no
 *  header: every line is `Name, Email, Role` with Role optional. */
function parsePdfLines(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  lines.forEach((line, i) => {
    const rowNumber = i + 1;
    const cells = line.split(',').map((cell) => cell.trim());
    const [name = '', email = '', role = ''] = cells;
    const result = validateRow(rowNumber, { name, email, role });
    if ('error' in result) errors.push(result.error);
    else rows.push(result.row);
  });

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

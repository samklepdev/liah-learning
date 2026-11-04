import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utils, write } from 'xlsx';
import { parseUserRows } from './user-import-parser.ts';

function xlsxBuffer(rows: string[][]): Buffer {
  const sheet = utils.aoa_to_sheet(rows);
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Sheet1');
  return write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parses an xlsx file with a header row', () => {
  const buffer = xlsxBuffer([
    ['Name', 'Email', 'Role'],
    ['Jane Doe', 'jane@example.com', 'admin'],
    ['John Roe', 'john@example.com', ''],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'admin' },
    { row: 3, name: 'John Roe', email: 'john@example.com', role: 'user' },
  ]);
});

test('xlsx header columns can be in any order, case-insensitively', () => {
  const buffer = xlsxBuffer([
    ['EMAIL', 'name'],
    ['jane@example.com', 'Jane Doe'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'user' }]);
});

test('parses a csv file the same way as xlsx', () => {
  const csv = 'Name,Email,Role\nJane Doe,jane@example.com,admin\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(csv, 'utf8'),
    originalname: 'students.csv',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'admin' }]);
});

test('reports a row error for a missing email without blocking other rows', () => {
  const buffer = xlsxBuffer([
    ['Name', 'Email'],
    ['No Email', ''],
    ['Has Email', 'has@example.com'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 2);
  assert.deepEqual(rows, [{ row: 3, name: 'Has Email', email: 'has@example.com', role: 'user' }]);
});

test('reports a row error for an invalid role', () => {
  const buffer = xlsxBuffer([
    ['Email', 'Role'],
    ['bad-role@example.com', 'superadmin'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 2);
});

test('parses PDF-style text (comma-separated, no header) via a .txt upload', () => {
  // The parser's PDF input is pdftotext's *output*; a .txt upload is used
  // as-is in tests to avoid a pdftotext/poppler dependency in CI — same
  // convention as admin-import.controller.test.ts.
  const text = 'Jane Doe, jane@example.com, admin\nJohn Roe, john@example.com\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(text, 'utf8'),
    originalname: 'roster.txt',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 1, name: 'Jane Doe', email: 'jane@example.com', role: 'admin' },
    { row: 2, name: 'John Roe', email: 'john@example.com', role: 'user' },
  ]);
});

test('keeps row numbers aligned to the physical file when a blank row is skipped', () => {
  const buffer = xlsxBuffer([
    ['Name', 'Email'],
    ['Jane Doe', 'jane@example.com'],
    [],
    ['Bad Row', 'not-an-email'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'user' }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 4);
});

test('rejects an unsupported file extension', () => {
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from('whatever'),
    originalname: 'students.docx',
  });

  assert.deepEqual(rows, []);
  assert.equal(errors.length, 1);
});

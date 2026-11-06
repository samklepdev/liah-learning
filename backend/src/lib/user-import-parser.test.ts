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
    ['First Name', 'Last Name', 'Role'],
    ['Jane', 'Doe', 'admin'],
    ['John', 'Roe', ''],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 2, firstName: 'Jane', lastName: 'Doe', role: 'admin' },
    { row: 3, firstName: 'John', lastName: 'Roe', role: 'user' },
  ]);
});

test('xlsx header columns can be in any order, case-insensitively', () => {
  const buffer = xlsxBuffer([
    ['LAST NAME', 'first name'],
    ['Doe', 'Jane'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }]);
});

test('parses a csv file the same way as xlsx', () => {
  const csv = 'First Name,Last Name,Role\nJane,Doe,admin\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(csv, 'utf8'),
    originalname: 'students.csv',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'admin' }]);
});

test('reports a row error for a missing last name without blocking other rows', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Last Name'],
    ['No Last Name', ''],
    ['Has Last Name', 'Smith'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 2);
  assert.deepEqual(rows, [{ row: 3, firstName: 'Has Last Name', lastName: 'Smith', role: 'user' }]);
});

test('reports a row error for an invalid role', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Last Name', 'Role'],
    ['Jane', 'Doe', 'superadmin'],
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
  const text = 'Jane, Doe, admin\nJohn, Roe\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(text, 'utf8'),
    originalname: 'roster.txt',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 1, firstName: 'Jane', lastName: 'Doe', role: 'admin' },
    { row: 2, firstName: 'John', lastName: 'Roe', role: 'user' },
  ]);
});

test('keeps row numbers aligned to the physical file when a blank row is skipped', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Last Name'],
    ['Jane', 'Doe'],
    [],
    ['Bad Row', ''],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 4);
});

test('reports an error when the First Name column is missing', () => {
  const buffer = xlsxBuffer([
    ['Last Name', 'Role'],
    ['Doe', 'admin'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, []);
  assert.deepEqual(errors, [{ row: 0, message: 'File is missing a "First Name" column.' }]);
});

test('reports an error when the Last Name column is missing', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Role'],
    ['Jane', 'admin'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, []);
  assert.deepEqual(errors, [{ row: 0, message: 'File is missing a "Last Name" column.' }]);
});

test('rejects an unsupported file extension', () => {
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from('whatever'),
    originalname: 'students.docx',
  });

  assert.deepEqual(rows, []);
  assert.equal(errors.length, 1);
});

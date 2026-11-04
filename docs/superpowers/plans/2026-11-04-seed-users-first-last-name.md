# Split Seeded-User Name into First/Last Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `name` field on admin-seeded users with separate `firstName`/`lastName` fields, before the still-unmerged seed-users-import feature merges.

**Architecture:** Mechanical rename/split applied consistently through every layer that currently carries `name`: the `users` table, `PublicUser` and its three column-selecting call sites, the xlsx/csv/PDF parser, the confirm controller, and the admin frontend (types, API client, `AdminUsersPage.tsx`). Each layer is one task so a reviewer can verify it in isolation; all five tasks together complete the rename.

**Tech Stack:** Same as the feature being amended — Express 5, Drizzle ORM (Postgres), Zod 4, SheetJS (`xlsx`, now the CDN release), React 19 + Vitest/Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-seed-users-first-last-name-design.md` — amends `docs/superpowers/specs/2026-11-04-seed-users-import-design.md`. Follow it exactly.
- Both `firstName` and `lastName` are independently optional/nullable — same looseness as the `name` field they replace.
- Scope is admin-seeded users only. Do not touch self-registration (`auth.controller.ts`) or the profile page — neither has a name field today and this change doesn't add one there.
- xlsx/csv header columns: `First Name` and `Last Name`, case-insensitive, any order (same convention as `Email`/`Role`).
- PDF/`.txt` lines: still headerless and positional, now `First Name, Last Name, Email, Role`.
- Work happens on branch `feat/seed-users-import` (already checked out, already has the rest of the feature committed). Commit after every passing step. Conventional Commits with `api`/`web` scope.

---

### Task 1: `firstName`/`lastName` columns, propagated through `PublicUser`

**Files:**
- Modify: `backend/src/models/schema.ts` (users table, line 18-19)
- Modify: `backend/src/models/user.model.ts` (`PublicUser`, `publicColumns`, `createUser`)
- Modify: `backend/src/models/admin-user.model.ts` (`publicColumns`)
- Modify: `backend/src/models/session.model.ts` (`findUserBySessionId`'s select)
- Modify: `backend/src/models/user.model.test.ts` (the two name-related tests)
- Modify: `backend/src/middleware/auth.middleware.test.ts` (two mock `PublicUser` literals, lines 18 and 22)
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `createUser(email: string, passwordHash: string, firstName?: string | null, lastName?: string | null, role?: 'user' | 'admin'): Promise<PublicUser | null>` — used by Task 3's confirm controller.
- Produces: `PublicUser` now has `firstName: string | null` and `lastName: string | null` instead of `name: string | null` — Task 4 (frontend `User`/`AdminUser` types) and Task 5 (`AdminUsersPage.tsx`) depend on this exact shape.

- [ ] **Step 1: Update the two existing name-related tests first**

In `backend/src/models/user.model.test.ts`, replace:

```ts
test('createUser stores an optional name and role', async () => {
  const user = await createUser('with-name@example.com', 'hash', 'Jane Doe', 'admin');
  assert.equal(user?.name, 'Jane Doe');
  assert.equal(user?.role, 'admin');
});

test('createUser defaults name to null when omitted', async () => {
  const user = await createUser('no-name@example.com', 'hash');
  assert.equal(user?.name, null);
});
```

with:

```ts
test('createUser stores an optional first/last name and role', async () => {
  const user = await createUser('with-name@example.com', 'hash', 'Jane', 'Doe', 'admin');
  assert.equal(user?.firstName, 'Jane');
  assert.equal(user?.lastName, 'Doe');
  assert.equal(user?.role, 'admin');
});

test('createUser defaults first/last name to null when omitted', async () => {
  const user = await createUser('no-name@example.com', 'hash');
  assert.equal(user?.firstName, null);
  assert.equal(user?.lastName, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern "createUser"`
Expected: FAIL — `createUser` doesn't yet accept 5 args in the new order, and `user.firstName`/`user.lastName` don't exist yet.

- [ ] **Step 3: Update the schema**

In `backend/src/models/schema.ts`, replace:

```ts
  /** Only set for admin-seeded users today; self-registered users have none. */
  name: text('name'),
```

with:

```ts
  /** Only set for admin-seeded users today; self-registered users have none. */
  firstName: text('first_name'),
  lastName: text('last_name'),
```

- [ ] **Step 4: Push the schema change to both databases**

Run: `npm run db:push -w backend` then `npm run db:push:test -w backend`
Expected: drizzle-kit reports dropping `name` and adding `first_name`/`last_name` on `users`, on both databases. Accept the prompt(s) — this is a dev database with no production data to preserve.

- [ ] **Step 5: Update `user.model.ts`**

```ts
export type PublicUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};

/** Returns null when the email is already registered. */
export async function createUser(
  email: string,
  passwordHash: string,
  firstName?: string | null,
  lastName?: string | null,
  role?: 'user' | 'admin',
): Promise<PublicUser | null> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      role: role ?? 'user',
    })
    .onConflictDoNothing({ target: users.email })
    .returning(publicColumns);

  return user ?? null;
}
```

Leave `findUserByEmailWithHash`, `findUserByIdWithHash`, `updatePasswordHash` unchanged — they spread `...publicColumns`, so they pick up the new fields automatically.

- [ ] **Step 6: Update `admin-user.model.ts`'s `publicColumns`**

```ts
const publicColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};
```

- [ ] **Step 7: Update `session.model.ts`'s select**

```ts
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
```

- [ ] **Step 8: Update the two mock `PublicUser` literals in `auth.middleware.test.ts`**

Lines 18 and 22 currently read (one of each):
```ts
return { id: 'u1', email: 'admin@example.com', name: null, role: 'admin', createdAt: new Date() };
```
```ts
return { id: 'u2', email: 'user@example.com', name: null, role: 'user', createdAt: new Date() };
```
Replace `name: null` with `firstName: null, lastName: null` in both.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "createUser"`
Expected: PASS.

- [ ] **Step 10: Typecheck and run the full backend suite**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: no type errors; full suite passes. (This will currently fail on the parser/controller tests from Tasks 2-3, which still reference `name` — that's expected until those tasks land. If you're executing this task in isolation, it's fine for those specific failures to remain; just confirm no *other* test regressed and that the `name`-shaped failures are exactly the ones in `user-import-parser.test.ts` and `admin-user-import.controller.test.ts`.)

- [ ] **Step 11: Commit**

```bash
git add backend/src/models/schema.ts backend/src/models/user.model.ts backend/src/models/user.model.test.ts backend/src/models/admin-user.model.ts backend/src/models/session.model.ts backend/src/middleware/auth.middleware.test.ts
git commit -m "feat(api): split users.name into firstName/lastName"
```

---

### Task 2: Parser — `firstName`/`lastName` columns and PDF positions

**Files:**
- Modify: `backend/src/lib/user-import-parser.ts`
- Modify: `backend/src/lib/user-import-parser.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 (this file doesn't import `PublicUser`).
- Produces: `ParsedUserRow = { row: number; firstName: string | null; lastName: string | null; email: string; role: Role }` — Task 3's controller depends on this exact shape.

- [ ] **Step 1: Update the test file**

Replace the full contents of `backend/src/lib/user-import-parser.test.ts`:

```ts
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
    ['First Name', 'Last Name', 'Email', 'Role'],
    ['Jane', 'Doe', 'jane@example.com', 'admin'],
    ['John', 'Roe', 'john@example.com', ''],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'admin' },
    { row: 3, firstName: 'John', lastName: 'Roe', email: 'john@example.com', role: 'user' },
  ]);
});

test('xlsx header columns can be in any order, case-insensitively', () => {
  const buffer = xlsxBuffer([
    ['EMAIL', 'first name', 'last name'],
    ['jane@example.com', 'Jane', 'Doe'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' },
  ]);
});

test('parses a csv file the same way as xlsx', () => {
  const csv = 'First Name,Last Name,Email,Role\nJane,Doe,jane@example.com,admin\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(csv, 'utf8'),
    originalname: 'students.csv',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'admin' },
  ]);
});

test('reports a row error for a missing email without blocking other rows', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Email'],
    ['No Email', ''],
    ['Has Email', 'has@example.com'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 2);
  assert.deepEqual(rows, [
    { row: 3, firstName: 'Has Email', lastName: null, email: 'has@example.com', role: 'user' },
  ]);
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
  const text = 'Jane, Doe, jane@example.com, admin\nJohn, Roe, john@example.com\n';
  const { rows, errors } = parseUserRows({
    buffer: Buffer.from(text, 'utf8'),
    originalname: 'roster.txt',
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 1, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'admin' },
    { row: 2, firstName: 'John', lastName: 'Roe', email: 'john@example.com', role: 'user' },
  ]);
});

test('keeps row numbers aligned to the physical file when a blank row is skipped', () => {
  const buffer = xlsxBuffer([
    ['First Name', 'Email'],
    ['Jane', 'jane@example.com'],
    [],
    ['Bad Row', 'not-an-email'],
  ]);
  const { rows, errors } = parseUserRows({ buffer, originalname: 'students.xlsx' });

  assert.deepEqual(rows, [
    { row: 2, firstName: 'Jane', lastName: null, email: 'jane@example.com', role: 'user' },
  ]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern "parses|rejects|reports|keeps row numbers"`
Expected: FAIL — the implementation still has a single `name` field, not `firstName`/`lastName`.

- [ ] **Step 3: Update the implementation**

Replace the full contents of `backend/src/lib/user-import-parser.ts`:

```ts
import { read, utils } from 'xlsx';
import { z } from 'zod';
import { extractPdfText } from './pdf-text.ts';

export type Role = 'user' | 'admin';
export type ParsedUserRow = {
  row: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: Role;
};
export type RowError = { row: number; message: string };
export type ParseResult = { rows: ParsedUserRow[]; errors: RowError[] };

const rowSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(['user', 'admin']).optional(),
});

/** Validates one raw {firstName, lastName, email, role} quadruple into a row or a row error. */
function validateRow(
  rowNumber: number,
  raw: { firstName: string; lastName: string; email: string; role: string },
): { row: ParsedUserRow } | { error: RowError } {
  const parsed = rowSchema.safeParse({
    firstName: raw.firstName.trim() === '' ? undefined : raw.firstName,
    lastName: raw.lastName.trim() === '' ? undefined : raw.lastName,
    email: raw.email,
    role: raw.role.trim() === '' ? undefined : raw.role.trim().toLowerCase(),
  });

  if (!parsed.success) {
    return { error: { row: rowNumber, message: `Row ${rowNumber}: ${z.prettifyError(parsed.error)}` } };
  }

  return {
    row: {
      row: rowNumber,
      firstName: parsed.data.firstName ?? null,
      lastName: parsed.data.lastName ?? null,
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
  const emailIdx = normalizedHeader.indexOf('email');
  const roleIdx = normalizedHeader.indexOf('role');
  if (emailIdx === -1) {
    return { rows: [], errors: [{ row: 0, message: 'File is missing an "Email" column.' }] };
  }

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  dataRows.forEach((cells, i) => {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row
    const isBlank = cells.every((cell) => cell === undefined || cell === null || String(cell).trim() === '');
    if (isBlank) return;

    const firstName = firstNameIdx === -1 ? '' : String(cells[firstNameIdx] ?? '');
    const lastName = lastNameIdx === -1 ? '' : String(cells[lastNameIdx] ?? '');
    const email = String(cells[emailIdx] ?? '');
    const role = roleIdx === -1 ? '' : String(cells[roleIdx] ?? '');
    const result = validateRow(rowNumber, { firstName, lastName, email, role });
    if ('error' in result) errors.push(result.error);
    else rows.push(result.row);
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: 'File has no data rows.' });
  }

  return { rows, errors };
}

/** PDF text (and the .txt fixtures that stand in for it in tests) has no
 *  header: every line is `First Name, Last Name, Email, Role` with role optional. */
function parsePdfLines(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  const rows: ParsedUserRow[] = [];
  const errors: RowError[] = [];
  lines.forEach((line, i) => {
    if (line === '') return;
    const rowNumber = i + 1;
    const cells = line.split(',').map((cell) => cell.trim());
    const [firstName = '', lastName = '', email = '', role = ''] = cells;
    const result = validateRow(rowNumber, { firstName, lastName, email, role });
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
```

(The local variable `name` inside `parseUserRows` is the lowercased filename, unrelated to the `firstName`/`lastName` rename — leave it as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "parses|rejects|reports|keeps row numbers"`
Expected: PASS for all cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors in this file (the controller will still fail until Task 3 — that's expected).

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/user-import-parser.ts backend/src/lib/user-import-parser.test.ts
git commit -m "feat(api): parse First Name/Last Name columns instead of Name"
```

---

### Task 3: Confirm controller — `firstName`/`lastName` in request and response

**Files:**
- Modify: `backend/src/controllers/admin-user-import.controller.ts`
- Modify: `backend/src/controllers/admin-user-import.controller.test.ts`

**Interfaces:**
- Consumes: `createUser(email, passwordHash, firstName?, lastName?, role?)` from Task 1; `ParsedUserRow` shape from Task 2.
- Produces: `POST /api/admin/users/import/confirm` response `{ created: Array<{ email: string; firstName: string | null; lastName: string | null; role: Role; password: string }>, skipped: [...] }` — Task 4's frontend types depend on this exact shape.

- [ ] **Step 1: Update the test file**

Replace the full contents of `backend/src/controllers/admin-user-import.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { findUserByEmailWithHash } from '../models/user.model.ts';

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  ({ baseUrl, close } = await startTestServer());
});

after(async () => {
  await close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function adminCookie() {
  const { cookie, userId } = await registerTestUser(baseUrl, 'admin@example.com');
  await setUserRole(userId, 'admin');
  return cookie;
}

function csvForm(csv: string, filename = 'students.csv') {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  return form;
}

test('POST /api/admin/users/import/parse returns rows and errors for a csv', async () => {
  const cookie = await adminCookie();
  const csv =
    'First Name,Last Name,Email,Role\nJane,Doe,jane@example.com,admin\nBad Row,X,not-an-email,\n';

  const res = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csv),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    rows: Array<{ email: string }>;
    errors: Array<{ row: number }>;
  };
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0]?.email, 'jane@example.com');
  assert.equal(body.errors.length, 1);
});

test('POST /api/admin/users/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const res = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm('First Name,Email\nA,a@example.com\n'),
  });
  assert.equal(res.status, 404);
});

test('POST /api/admin/users/import/confirm creates users with a hashed password', async () => {
  const cookie = await adminCookie();
  const rows = [
    { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'admin' as const },
  ];

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{
      email: string;
      firstName: string | null;
      lastName: string | null;
      role: string;
      password: string;
    }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.email, 'jane@example.com');
  assert.equal(body.created[0]?.firstName, 'Jane');
  assert.equal(body.created[0]?.lastName, 'Doe');
  assert.equal(body.created[0]?.role, 'admin');
  assert.ok(body.created[0]?.password && body.created[0].password.length > 0);
  assert.deepEqual(body.skipped, []);

  const stored = await findUserByEmailWithHash('jane@example.com');
  assert.notEqual(stored?.passwordHash, body.created[0]?.password);
});

test('POST /api/admin/users/import/confirm skips an already-registered email', async () => {
  const cookie = await adminCookie();
  await registerTestUser(baseUrl, 'existing@example.com');

  const rows = [
    { row: 2, firstName: null, lastName: null, email: 'existing@example.com', role: 'user' as const },
  ];
  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { created: unknown[]; skipped: Array<{ email: string }> };
  assert.deepEqual(body.created, []);
  assert.equal(body.skipped[0]?.email, 'existing@example.com');
});

test('a 150-row parse-then-confirm round trip creates every row', async () => {
  const cookie = await adminCookie();
  const csvLines = ['First Name,Last Name,Email,Role'];
  for (let i = 0; i < 150; i++) {
    csvLines.push(`User,${i},user${i}@example.com,user`);
  }

  const parseRes = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csvLines.join('\n') + '\n'),
  });
  assert.equal(parseRes.status, 200);
  const parsed = (await parseRes.json()) as {
    rows: Array<{ row: number; firstName: string | null; lastName: string | null; email: string; role: string }>;
    errors: unknown[];
  };
  assert.equal(parsed.rows.length, 150);
  assert.deepEqual(parsed.errors, []);

  const confirmRes = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: parsed.rows }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmed = (await confirmRes.json()) as { created: unknown[]; skipped: unknown[] };
  assert.equal(confirmed.created.length, 150);
  assert.deepEqual(confirmed.skipped, []);
});

test('POST /api/admin/users/import/confirm rejects more than 200 rows', async () => {
  const cookie = await adminCookie();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    row: i + 2,
    firstName: `User ${i}`,
    lastName: 'Test',
    email: `user${i}@example.com`,
    role: 'user' as const,
  }));

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 400);
});

test('a 200-row body over 100KB still succeeds under the 2mb carve-out', async () => {
  const cookie = await adminCookie();
  const padding = 'x'.repeat(2000);
  const rows = Array.from({ length: 200 }, (_, i) => ({
    row: i + 2,
    firstName: `User ${padding}${i}`,
    lastName: 'Test',
    email: `user${i}-${padding}@example.com`.toLowerCase(),
    role: 'user' as const,
  }));

  const body = JSON.stringify({ rows });
  assert.ok(Buffer.byteLength(body) > 100 * 1024, 'test body should exceed 100KB');
  assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024, 'test body should stay under 2MB');

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body,
  });
  assert.equal(res.status, 200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern "import/parse|import/confirm|round trip"`
Expected: FAIL — the controller's `confirmBody` schema still expects `name`, not `firstName`/`lastName`, so these requests 400.

- [ ] **Step 3: Update the implementation**

Replace the full contents of `backend/src/controllers/admin-user-import.controller.ts`:

```ts
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseUserRows } from '../lib/user-import-parser.ts';
import { createUser } from '../models/user.model.ts';

/** User lists are small — far below the 10MB cap on the quiz-PDF importer. */
export const uploadFile = multer({ limits: { fileSize: 5 * 1024 * 1024 } }).single('file');

export function parseImport(req: Request, res: Response): void {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded under field "file"' });
    return;
  }

  let result;
  try {
    result = parseUserRows({ buffer: file.buffer, originalname: file.originalname });
  } catch {
    // pdftotext failed on a malformed/corrupt PDF — same 422 handling as
    // admin-import.controller.ts's parseImport.
    res.status(422).json({
      error: 'Could not extract text from the uploaded file.',
      errors: [{ row: 0, message: 'Could not extract text from the uploaded file.' }],
    });
    return;
  }
  res.json(result);
}

const confirmBody = z.object({
  rows: z
    .array(
      z.object({
        row: z.number(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        email: z.string().trim().toLowerCase().pipe(z.email()),
        role: z.enum(['user', 'admin']),
      }),
    )
    .max(200, 'A single import is limited to 200 rows. Split larger files and import in batches.'),
});

/** 9 random bytes -> 12 base64url characters, ~72 bits of entropy. */
function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

export async function confirmImport(req: Request, res: Response): Promise<void> {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const created: Array<{
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    password: string;
  }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const row of parsed.data.rows) {
    const password = generatePassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await createUser(row.email, passwordHash, row.firstName, row.lastName, row.role);

    if (!user) {
      skipped.push({ email: row.email, reason: 'already registered' });
      continue;
    }
    created.push({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      password,
    });
  }

  res.json({ created, skipped });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "import/parse|import/confirm|round trip"`
Expected: PASS for all cases.

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: everything passes now — Tasks 1-3 together complete the backend half of the rename.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin-user-import.controller.ts backend/src/controllers/admin-user-import.controller.test.ts
git commit -m "feat(api): confirm imports with firstName/lastName instead of name"
```

---

### Task 4: Frontend types and API client

**Files:**
- Modify: `frontend/src/auth/api.ts` (`User` type)
- Modify: `frontend/src/admin/api.ts` (`ImportedUserRow`, `ConfirmedUser` types)
- Modify: `frontend/src/admin/api.test.ts` (one test's row literal)

**Interfaces:**
- Consumes: the backend response shapes from Tasks 1-3 (`PublicUser` with `firstName`/`lastName`; confirm's `created[]` with `firstName`/`lastName`).
- Produces: `User`, `ImportedUserRow`, `ConfirmedUser` with `firstName: string | null` and `lastName: string | null` instead of `name` — Task 5's `AdminUsersPage.tsx` depends on these exact field names.

- [ ] **Step 1: Update the one affected test**

In `frontend/src/admin/api.test.ts`, in the `confirmUserImport posts the rows...` test, replace:

```ts
const rows = [{ row: 2, name: 'Jane', email: 'jane@example.com', role: 'user' as const }];
```

with:

```ts
const rows = [
  { row: 2, firstName: 'Jane', lastName: null, email: 'jane@example.com', role: 'user' as const },
];
```

(The rest of that test, including the `JSON.stringify({ rows })` assertion, is unchanged — it already stringifies whatever `rows` is.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w frontend -- api.test.ts`
Expected: FAIL only if type-checking surfaces it at build time; functionally the test may still pass at runtime since nothing in `admin/api.ts` reads into the row's fields before stringifying. Either way, proceed to Step 3 so the types are correct before Task 5 depends on them.

- [ ] **Step 3: Update `User` in `auth/api.ts`**

```ts
export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  createdAt: string;
};
```

- [ ] **Step 4: Update the import types in `admin/api.ts`**

```ts
export type ImportedUserRow = {
  row: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: 'user' | 'admin';
};
export type ImportRowError = { row: number; message: string };
export type ConfirmedUser = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  password: string;
};
export type SkippedUser = { email: string; reason: string };
```

(No other part of `admin/api.ts` references `name` — `parseUserImport`/`confirmUserImport`'s bodies are unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w frontend -- api.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run build -w frontend` (this will currently fail inside `AdminUsersPage.tsx`, which still references `.name` — that's expected until Task 5. If executing this task in isolation, confirm the *only* failures are in `AdminUsersPage.tsx`/`AdminUsersPage.test.tsx`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/admin/api.ts frontend/src/admin/api.test.ts
git commit -m "feat(web): type user imports with firstName/lastName instead of name"
```

---

### Task 5: `AdminUsersPage` — first/last name columns, preview, results, CSV export

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `AdminUser`, `ImportedUserRow`, `ConfirmedUser` from Task 4.

- [ ] **Step 1: Update the test file's mocks and assertions**

In `frontend/src/pages/admin/AdminUsersPage.test.tsx`:

1. In `beforeEach`, both `listUsers.mockResolvedValue(...)` user literals currently have `name: null` — replace each with `firstName: null, lastName: null`:

```ts
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
```

2. In `selectImportFile`, update the dummy file content for realism (it's never actually parsed since `parseUserImport` is mocked, but keep it consistent with the new format):

```ts
  function selectImportFile() {
    const file = new File(['First Name,Last Name,Email\nJane,Doe,jane@example.com'], 'students.csv', {
      type: 'text/csv',
    });
    const input = screen.getByLabelText(/user list file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }
```

3. In `'parsing a file shows a preview with row errors'`, replace the mocked row:

```ts
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [{ row: 3, message: 'Row 3: invalid email' }],
    });
```

4. In `'confirming an import shows generated passwords and reloads the user list'`, replace both mocked literals:

```ts
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
```

5. In `'copying created users writes an email,name,role,password CSV to the clipboard'`, replace both mocked literals the same way as step 4 above (identical replacement, same test structure, same assertions on `'jane@example.com'` and `'abc123'` substrings — those still hold since email/password are unchanged).

The remaining tests (`lists every user with their role`, the self-protection test, promote/delete tests, and `Confirm import is disabled when there are no valid rows`) don't reference `name` and need no changes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: FAIL — the component still renders `.name`, which is now `undefined` on the updated mock data (no `name` property), so cells render empty instead of the expected values, and the component's own TypeScript compilation (via `vite`'s esbuild transform in the test run) may also complain depending on strictness. Either way, proceed to Step 3.

- [ ] **Step 3: Update `AdminUsersPage.tsx`**

Four spots change, each replacing a single `Name` column with two `First Name`/`Last Name` columns and `.name` with `.firstName`/`.lastName`:

**a) The preview table** (around the `import-preview` block):

```tsx
            <table className="admin-table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.firstName ?? '—'}</td>
                    <td>{r.lastName ?? '—'}</td>
                    <td>{r.email}</td>
                    <td>{r.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
```

**b) The CSV export in the "Copy all as CSV" button's `onClick`:**

```tsx
                  onClick={() => {
                    const header = 'email,firstName,lastName,role,password';
                    const lines = importResults.created.map(
                      (u) => `${u.email},${u.firstName ?? ''},${u.lastName ?? ''},${u.role},${u.password}`,
                    );
                    void navigator.clipboard.writeText([header, ...lines].join('\n'));
                  }}
```

**c) The "Created" results table:**

```tsx
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Role</th>
                      <th>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.created.map((u) => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>{u.firstName ?? '—'}</td>
                        <td>{u.lastName ?? '—'}</td>
                        <td>{u.role}</td>
                        <td>{u.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
```

**d) The main users table:**

```tsx
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.firstName ?? '—'}</td>
                  <td>{u.lastName ?? '—'}</td>
                  <td>{u.role}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="admin-actions">
                    <button
                      type="button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void toggleRole(u)}
                    >
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                    <button
                      type="button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void remove(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
```

Nothing else in the file changes — imports, state, `parseFile`, `confirmImport`, and the `import-errors`/`Skipped` blocks are untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: PASS for all cases, including the pre-existing promote/demote/delete tests and the CSV-copy test (which asserts the CSV contains `'jane@example.com'` and `'abc123'` — still true with the new header).

- [ ] **Step 5: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; build succeeds with no TypeScript errors anywhere referencing `.name` on a `User`/`AdminUser`/`ImportedUserRow`/`ConfirmedUser`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(web): show first/last name columns instead of a single name"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `npm run test`
Expected: both workspaces pass.

- [ ] **Step 2: Confirm no stray references to the old field remain**

Run: `grep -rn '\bname\b' backend/src/models/schema.ts backend/src/models/user.model.ts backend/src/models/admin-user.model.ts backend/src/models/session.model.ts backend/src/lib/user-import-parser.ts backend/src/controllers/admin-user-import.controller.ts frontend/src/auth/api.ts frontend/src/admin/api.ts frontend/src/pages/admin/AdminUsersPage.tsx`
Expected: no matches referring to the old single `name` user field. (Matches on unrelated identifiers like `originalname`, `subjectTitle`, `sheetName`, `filename`, or `bookType` are fine — read each hit and confirm it isn't the old field.)

- [ ] **Step 3: Report back**

No commit for this task. If Step 2 finds a stray reference, treat it as a bug against the task that owns that file, fix it there, and re-run Step 1.

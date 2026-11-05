# Seed Users via Admin Upload (xlsx/csv/PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin bulk-create user accounts from an uploaded xlsx, csv, or PDF file, previewing parsed rows before confirming, with auto-generated passwords shown once after confirm.

**Architecture:** Mirrors the existing quiz-content importer's two-step `parse` → `confirm` flow. A new shared parser (`lib/user-import-parser.ts`) normalizes all three file types into the same `{ name?, email, role? }` row shape; `/parse` validates and previews without writing to the DB; `/confirm` inserts rows that don't already exist (duplicates are skipped, not errored) and returns the plaintext generated passwords exactly once.

**Tech Stack:** Express 5, Drizzle ORM (Postgres), Zod 4, argon2, multer, SheetJS (`xlsx`, new dependency) for xlsx/csv parsing, the existing `pdftotext` CLI pathway for PDF text extraction, React 19 + Vitest/Testing Library on the frontend.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-seed-users-import-design.md` — follow it exactly; this plan does not deviate from it.
- No emailing of invites/reset links — passwords are shown once in the admin UI only (spec "Out" section).
- Generated plaintext passwords are never persisted or logged — only their argon2 hash is stored (spec "Backend" section).
- Duplicate emails on confirm are skipped, not mutated and not treated as a parse error (spec "Error handling" table).
- PDF rows have no header row and are comma-separated `Name, Email, Role` per line (spec "File formats" section).
- xlsx/csv rows have a header row (`Name`, `Email`, `Role`, case-insensitive, any column order) (spec "File formats" section).
- Work happens on branch `feat/seed-users-import` (already checked out); commit after every passing step per repo convention (Conventional Commits, `api`/`web` scope).

---

### Task 1: `name` column on `users`, propagated through `PublicUser`

**Files:**
- Modify: `backend/src/models/schema.ts` (users table definition, ~line 14-23)
- Modify: `backend/src/models/user.model.ts` (`PublicUser` type, `publicColumns`, `createUser`)
- Modify: `backend/src/models/admin-user.model.ts` (`publicColumns`)
- Modify: `backend/src/models/session.model.ts` (`findUserBySessionId`'s select)
- Modify: `backend/src/models/user.model.test.ts` (new test)
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `createUser(email: string, passwordHash: string, name?: string | null, role?: 'user' | 'admin'): Promise<PublicUser | null>` — used by Task 5's confirm controller.
- Produces: `PublicUser` now includes `name: string | null` — every other task that touches a user object (frontend `User` type in Task 6, `AdminUsersPage` in Task 7) must account for this field.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/models/user.model.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "createUser stores an optional name"`
Expected: FAIL — `createUser` doesn't accept a third/fourth argument, or `user.name` is `undefined` because the column doesn't exist yet.

- [ ] **Step 3: Add the `name` column to the schema**

In `backend/src/models/schema.ts`, add a `name` field to the `users` table (right after `email`, before `passwordHash`, so it reads top-to-bottom as the fields a human fills in):

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased and trimmed; see normalizeEmail(). */
  email: text('email').notNull().unique(),
  /** Only set for admin-seeded users today; self-registered users have none. */
  name: text('name'),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Push the schema to the dev and test databases**

Run: `npm run db:push -w backend` then `npm run db:push:test -w backend`
Expected: drizzle-kit reports adding the `name` column to `users` on both databases; accept the prompt if it asks to confirm a non-destructive column addition.

- [ ] **Step 5: Update `user.model.ts`**

In `backend/src/models/user.model.ts`:

```ts
/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
};

/** Returns null when the email is already registered. */
export async function createUser(
  email: string,
  passwordHash: string,
  name?: string | null,
  role?: 'user' | 'admin',
): Promise<PublicUser | null> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, name: name ?? null, role: role ?? 'user' })
    .onConflictDoNothing({ target: users.email })
    .returning(publicColumns);

  return user ?? null;
}
```

Leave the rest of the file (`findUserByEmailWithHash`, `findUserByIdWithHash`, `updatePasswordHash`) unchanged — they already spread `...publicColumns`, so they pick up `name` automatically.

- [ ] **Step 6: Update `admin-user.model.ts`'s `publicColumns`**

In `backend/src/models/admin-user.model.ts`:

```ts
const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
};
```

- [ ] **Step 7: Update `session.model.ts`'s select**

In `backend/src/models/session.model.ts`, `findUserBySessionId`'s `.select({...})` must also return `name` so its result still satisfies `PublicUser`:

```ts
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "createUser"`
Expected: PASS for all `createUser` tests.

- [ ] **Step 9: Typecheck and run the full backend suite**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: no type errors; full suite passes (confirms `req.user` typing and every `publicColumns` call site still line up).

- [ ] **Step 10: Commit**

```bash
git add backend/src/models/schema.ts backend/src/models/user.model.ts backend/src/models/user.model.test.ts backend/src/models/admin-user.model.ts backend/src/models/session.model.ts
git commit -m "feat(api): add nullable name column to users"
```

---

### Task 2: Add the `xlsx` dependency

**Files:**
- Modify: `backend/package.json`

**Interfaces:**
- Produces: the `xlsx` package (SheetJS) importable as `import { read, utils } from 'xlsx'`, used by Task 4.

- [ ] **Step 1: Install**

Run: `npm install xlsx@^0.18.5 -w backend`
Expected: `backend/package.json` dependencies gain `"xlsx": "^0.18.5"`; `package-lock.json` updates.

- [ ] **Step 2: Verify it imports cleanly under this project's module settings**

Run: `node -e "import('xlsx').then((m) => console.log(typeof m.read, typeof m.utils))"` from `backend/`
Expected: prints `function function`.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(api): add xlsx for parsing user-seed spreadsheets"
```

---

### Task 3: Extract shared `pdftotext` helper

**Files:**
- Create: `backend/src/lib/pdf-text.ts`
- Modify: `backend/src/controllers/admin-import.controller.ts` (its local `extractText`, lines 18-27)

**Interfaces:**
- Produces: `extractPdfText(buffer: Buffer): string` — runs `pdftotext -layout` on a PDF buffer, throws on failure. Used by Task 4's PDF branch and by the refactored `admin-import.controller.ts`.

This is a pure extraction of existing duplicated logic (the new user-import parser needs the exact same `pdftotext` invocation `admin-import.controller.ts` already has) — no behavior change, so no new test is needed beyond confirming the existing suite still passes.

- [ ] **Step 1: Create the shared helper**

`backend/src/lib/pdf-text.ts`:

```ts
import { execFileSync } from 'node:child_process';

/** Runs pdftotext on a PDF buffer and returns the extracted plain text. */
export function extractPdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}
```

- [ ] **Step 2: Use it from `admin-import.controller.ts`**

The top of the file currently starts:

```ts
import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseQuizPack, QuizParseError, slugify, type ParsedSubject } from '../lib/quiz-parser.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
```

Change the first import line and delete the `extractText` function body (keep the function, just change what it calls):

```ts
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { extractPdfText } from '../lib/pdf-text.ts';
import { parseQuizPack, QuizParseError, slugify, type ParsedSubject } from '../lib/quiz-parser.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
```

i.e. the `node:child_process` import is removed entirely (nothing else in this file uses `execFileSync`), and a new `extractPdfText` import is added. Then update the function body:

```ts
/**
 * A .txt upload (used by tests, which post pre-extracted text to avoid a
 * pdftotext/poppler dependency in CI) is used as-is.
 */
function extractText(file: Express.Multer.File): string {
  if (file.originalname.toLowerCase().endsWith('.txt')) {
    return file.buffer.toString('utf8');
  }
  return extractPdfText(file.buffer);
}
```

The call site (`extractText(file)` inside `parseImport`, and the `try { ... } catch { res.status(422)... }` wrapped around it) is unchanged — it already catches whatever `extractText` throws.

- [ ] **Step 3: Run the existing admin-import tests to confirm no regression**

Run: `npm run test -w backend -- --test-name-pattern "admin/import"`
Expected: PASS, identical to before the refactor.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors (confirms the unused `execFileSync` import was fully removed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/pdf-text.ts backend/src/controllers/admin-import.controller.ts
git commit -m "refactor(api): extract shared pdftotext helper"
```

---

### Task 4: `user-import-parser.ts` — parse xlsx/csv/PDF into validated rows

**Files:**
- Create: `backend/src/lib/user-import-parser.ts`
- Test: `backend/src/lib/user-import-parser.test.ts`

**Interfaces:**
- Consumes: `extractPdfText(buffer: Buffer): string` from Task 3.
- Produces:
  ```ts
  export type Role = 'user' | 'admin';
  export type ParsedUserRow = { row: number; name: string | null; email: string; role: Role };
  export type RowError = { row: number; message: string };
  export type ParseResult = { rows: ParsedUserRow[]; errors: RowError[] };
  export function parseUserRows(file: { buffer: Buffer; originalname: string }): ParseResult;
  ```
  Used by Task 5's `parseImport` controller.

- [ ] **Step 1: Write the failing tests**

`backend/src/lib/user-import-parser.test.ts`:

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

Run: `npm run test -w backend -- --test-name-pattern "parses|rejects|reports"`
Expected: FAIL — `./user-import-parser.ts` does not exist yet.

- [ ] **Step 3: Implement the parser**

`backend/src/lib/user-import-parser.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "parses|rejects|reports"`
Expected: PASS for all cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/user-import-parser.ts backend/src/lib/user-import-parser.test.ts
git commit -m "feat(api): parse xlsx/csv/PDF files into validated user rows"
```

---

### Task 5: `admin-user-import.controller.ts` + routes

**Files:**
- Create: `backend/src/controllers/admin-user-import.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-user-import.controller.test.ts`

**Interfaces:**
- Consumes: `parseUserRows` from Task 4; `createUser(email, passwordHash, name?, role?)` from Task 1.
- Produces:
  - `POST /api/admin/users/import/parse` → `{ rows: ParsedUserRow[], errors: RowError[] }`
  - `POST /api/admin/users/import/confirm` → `{ created: Array<{ email: string; name: string | null; role: Role; password: string }>, skipped: Array<{ email: string; reason: string }> }`
  Used by Task 6's frontend `admin/api.ts`.

- [ ] **Step 1: Write the failing tests**

`backend/src/controllers/admin-user-import.controller.test.ts`:

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
  const csv = 'Name,Email,Role\nJane Doe,jane@example.com,admin\nBad Row,not-an-email,\n';

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
    body: csvForm('Name,Email\nA,a@example.com\n'),
  });
  assert.equal(res.status, 404);
});

test('POST /api/admin/users/import/confirm creates users with a hashed password', async () => {
  const cookie = await adminCookie();
  const rows = [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }];

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{ email: string; name: string | null; role: string; password: string }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.email, 'jane@example.com');
  assert.equal(body.created[0]?.role, 'admin');
  assert.ok(body.created[0]?.password && body.created[0].password.length > 0);
  assert.deepEqual(body.skipped, []);

  const stored = await findUserByEmailWithHash('jane@example.com');
  assert.notEqual(stored?.passwordHash, body.created[0]?.password);
});

test('POST /api/admin/users/import/confirm skips an already-registered email', async () => {
  const cookie = await adminCookie();
  await registerTestUser(baseUrl, 'existing@example.com');

  const rows = [{ row: 2, name: null, email: 'existing@example.com', role: 'user' as const }];
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern "import/parse|import/confirm"`
Expected: FAIL — 404 (route doesn't exist) for every case.

- [ ] **Step 3: Implement the controller**

`backend/src/controllers/admin-user-import.controller.ts`:

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
    res.status(422).json({ errors: [{ row: 0, message: 'Could not extract text from the uploaded file.' }] });
    return;
  }
  res.json(result);
}

const confirmBody = z.object({
  rows: z.array(
    z.object({
      row: z.number(),
      name: z.string().nullable(),
      email: z.string().trim().toLowerCase().pipe(z.email()),
      role: z.enum(['user', 'admin']),
    }),
  ),
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

  const created: Array<{ email: string; name: string | null; role: string; password: string }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const row of parsed.data.rows) {
    const password = generatePassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await createUser(row.email, passwordHash, row.name, row.role);

    if (!user) {
      skipped.push({ email: row.email, reason: 'already registered' });
      continue;
    }
    created.push({ email: user.email, name: user.name, role: user.role, password });
  }

  res.json({ created, skipped });
}
```

- [ ] **Step 4: Wire the routes**

In `backend/src/routes/admin.routes.ts`:

```ts
import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';
import * as adminUserImport from '../controllers/admin-user-import.controller.ts';
import { adminImportRouter } from './admin-import.routes.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
adminRouter.post('/users/import/parse', adminUserImport.uploadFile, adminUserImport.parseImport);
adminRouter.post('/users/import/confirm', adminUserImport.confirmImport);
adminRouter.use('/import', adminImportRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "import/parse|import/confirm"`
Expected: PASS for all cases.

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: everything passes, including the pre-existing admin routes (confirms no path collision with `/users/:id`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/admin-user-import.controller.ts backend/src/controllers/admin-user-import.controller.test.ts backend/src/routes/admin.routes.ts
git commit -m "feat(api): add user-seed import parse/confirm endpoints"
```

---

### Task 6: Frontend API client

**Files:**
- Modify: `frontend/src/auth/api.ts` (`User` type)
- Modify: `frontend/src/admin/api.ts`
- Modify: `frontend/src/admin/api.test.ts`

**Interfaces:**
- Consumes: `POST /api/admin/users/import/parse`, `POST /api/admin/users/import/confirm` from Task 5.
- Produces:
  ```ts
  export type ImportedUserRow = { row: number; name: string | null; email: string; role: 'user' | 'admin' };
  export type ImportRowError = { row: number; message: string };
  export type ConfirmedUser = { email: string; name: string | null; role: 'user' | 'admin'; password: string };
  export type SkippedUser = { email: string; reason: string };

  adminApi.parseUserImport(file: File): Promise<{ rows: ImportedUserRow[]; errors: ImportRowError[] }>
  adminApi.confirmUserImport(rows: ImportedUserRow[]): Promise<{ created: ConfirmedUser[]; skipped: SkippedUser[] }>
  ```
  Used by Task 7's `AdminUsersPage`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/admin/api.test.ts`:

```ts
test('parseUserImport posts multipart form data to the import/parse endpoint', async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ rows: [], errors: [] }),
  });

  const file = new File(['Name,Email\nA,a@example.com'], 'students.csv', { type: 'text/csv' });
  await adminApi.parseUserImport(file);

  const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(call[0]).toBe('/api/admin/users/import/parse');
  expect(call[1].body).toBeInstanceOf(FormData);
  expect(call[1].headers).toBeUndefined();
});

test('confirmUserImport posts the rows to the import/confirm endpoint', async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ created: [], skipped: [] }),
  });

  const rows = [{ row: 2, name: 'Jane', email: 'jane@example.com', role: 'user' as const }];
  await adminApi.confirmUserImport(rows);

  expect(fetch).toHaveBeenCalledWith(
    '/api/admin/users/import/confirm',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ rows }) }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w frontend -- api.test.ts`
Expected: FAIL — `adminApi.parseUserImport`/`confirmUserImport` don't exist.

- [ ] **Step 3: Add `name` to the shared `User` type**

In `frontend/src/auth/api.ts`:

```ts
export type User = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  createdAt: string;
};
```

- [ ] **Step 4: Implement the API client additions**

In `frontend/src/admin/api.ts`, add alongside the existing exports:

```ts
export type ImportedUserRow = {
  row: number;
  name: string | null;
  email: string;
  role: 'user' | 'admin';
};
export type ImportRowError = { row: number; message: string };
export type ConfirmedUser = { email: string; name: string | null; role: 'user' | 'admin'; password: string };
export type SkippedUser = { email: string; reason: string };
```

And inside the `adminApi` object:

```ts
  parseUserImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ rows: ImportedUserRow[]; errors: ImportRowError[] }>(
      '/admin/users/import/parse',
      { method: 'POST', body: form },
    );
  },

  confirmUserImport: (rows: ImportedUserRow[]) =>
    request<{ created: ConfirmedUser[]; skipped: SkippedUser[] }>('/admin/users/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w frontend -- api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/admin/api.ts frontend/src/admin/api.test.ts
git commit -m "feat(web): add user-import API client calls"
```

---

### Task 7: `AdminUsersPage` upload section

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `adminApi.parseUserImport`, `adminApi.confirmUserImport`, `ImportedUserRow`, `ImportRowError`, `ConfirmedUser`, `SkippedUser` from Task 6.

- [ ] **Step 1: Update existing test mocks for the new `name` field and API calls**

In `frontend/src/pages/admin/AdminUsersPage.test.tsx`, update the `vi.mock('../../admin/api', ...)` block and `listUsers`/`setRole` mock data to include `name: null`, and add the two new mocked functions:

```ts
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
        name: null,
        role: 'admin',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'u2',
        email: 'student@example.com',
        name: null,
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
```

- [ ] **Step 2: Write the failing tests for the upload section**

Add to `frontend/src/pages/admin/AdminUsersPage.test.tsx`:

```ts
function selectImportFile() {
  const file = new File(['Name,Email\nJane,jane@example.com'], 'students.csv', { type: 'text/csv' });
  const input = screen.getByLabelText(/user list file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

test('parsing a file shows a preview with row errors', async () => {
  parseUserImport.mockResolvedValue({
    rows: [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'user' }],
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
    rows: [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'user' }],
    errors: [],
  });
  confirmUserImport.mockResolvedValue({
    created: [{ email: 'jane@example.com', name: 'Jane Doe', role: 'user', password: 'abc123' }],
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

test('Confirm import is disabled when there are no valid rows', async () => {
  parseUserImport.mockResolvedValue({ rows: [], errors: [{ row: 1, message: 'bad row' }] });
  render(<AdminUsersPage />);
  await screen.findByText('admin@example.com');

  selectImportFile();
  fireEvent.click(screen.getByRole('button', { name: /parse/i }));

  await screen.findByText(/bad row/i);
  expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: FAIL — no file input labeled "user list file", no Parse/Confirm import UI.

- [ ] **Step 4: Implement the upload section**

Replace the full contents of `frontend/src/pages/admin/AdminUsersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type AdminUser,
  type ConfirmedUser,
  type ImportedUserRow,
  type ImportRowError,
  type SkippedUser,
} from '../../admin/api';
import { useAuth } from '../../auth/useAuth';

type ImportResults = { created: ConfirmedUser[]; skipped: SkippedUser[] };

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportedUserRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listUsers()
      .then((res) => setUsers(res.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRole = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      const nextRole = target.role === 'admin' ? 'user' : 'admin';
      const { user } = await adminApi.setRole(target.id, nextRole);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      await adminApi.deleteUser(target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };

  const parseFile = async () => {
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);
    setImportResults(null);
    try {
      const { rows, errors } = await adminApi.parseUserImport(importFile);
      setParsedRows(rows);
      setParseErrors(errors);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = async () => {
    if (parsedRows.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const results = await adminApi.confirmUserImport(parsedRows);
      setImportResults(results);
      setParsedRows([]);
      setParseErrors([]);
      setImportFile(null);
      load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>Users</h1>

      <section className="admin-import-users">
        <h2>Seed users from a file</h2>
        <div className="auth-form import-form">
          <div className="auth-fields">
            <input
              type="file"
              accept=".xlsx,.csv,.pdf"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              aria-label="User list file"
            />
          </div>

          {importError && (
            <p role="alert" className="auth-error">
              {importError}
            </p>
          )}

          <button
            type="button"
            className="auth-submit"
            disabled={importBusy || !importFile}
            aria-busy={importBusy}
            onClick={() => void parseFile()}
          >
            {importBusy ? 'Working…' : 'Parse'}
          </button>
        </div>

        {parseErrors.length > 0 && (
          <div className="import-errors" role="alert">
            <h3>Row errors</h3>
            <ul>
              {parseErrors.map((e) => (
                <li key={e.row}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {parsedRows.length > 0 && (
          <div className="import-preview">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.name ?? '—'}</td>
                    <td>{r.email}</td>
                    <td>{r.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="auth-submit"
              disabled={importBusy}
              aria-busy={importBusy}
              onClick={() => void confirmImport()}
            >
              Confirm import
            </button>
          </div>
        )}

        {importResults && (
          <div className="import-results">
            {importResults.created.length > 0 && (
              <>
                <h3>Created</h3>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.created.map((u) => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>{u.name ?? '—'}</td>
                        <td>{u.role}</td>
                        <td>{u.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {importResults.skipped.length > 0 && (
              <>
                <h3>Skipped</h3>
                <ul>
                  {importResults.skipped.map((s) => (
                    <li key={s.email}>
                      {s.email}: {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
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
                  <td>{u.name ?? '—'}</td>
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
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: PASS for all cases, including the pre-existing promote/demote/delete tests.

- [ ] **Step 6: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; the build succeeds (confirms no TypeScript errors from the new `User.name` field anywhere else it's consumed, e.g. `ProfilePage.tsx`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(web): seed users from an uploaded xlsx/csv/PDF file"
```

---

### Task 8: End-to-end smoke test

**Files:** none (manual verification only)

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `npm run test`
Expected: both workspaces pass.

- [ ] **Step 2: Start the app and exercise the feature by hand**

Run: `npm run dev -w backend` and `npm run dev -w frontend` (or the project's combined dev script, if one exists — check `package.json` at the repo root).

In the browser, sign in as an admin, go to `/admin/users`, and:
1. Upload a small `.csv` with a header row (`Name,Email,Role`) and 2-3 rows, one with an email that already exists. Click Parse — confirm the preview table and any row errors render.
2. Click Confirm import — confirm the created table shows a password per new user, the skipped list shows the duplicate with reason "already registered", and the main user list below refreshes to include the new accounts.
3. Repeat with a `.xlsx` file built the same way (e.g. via Excel/Numbers/Google Sheets export) to confirm the real SheetJS path (not just the test's buffer-built fixture) works.
4. If `pdftotext`/poppler is installed locally, repeat with a PDF containing comma-separated `Name, Email, Role` lines, one per line, no header.

Expected: all three file types produce the same end result — new accounts created with the shown passwords, duplicates skipped and reported, no console errors.

- [ ] **Step 3: Report back**

No commit for this task — it's verification only. If anything in step 2 doesn't match the expected behavior, treat it as a bug against the relevant task above rather than editing code in this step.

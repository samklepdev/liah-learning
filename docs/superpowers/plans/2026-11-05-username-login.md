# Username Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email with a system-generated `username` across the data model, auth flow, admin bulk-import, and seed script, and switch login from email+password to username+password.

**Architecture:** Drop the `email` column from the `users` table and add a `notNull().unique()` `username` column. A single helper (`buildBaseUsername`) derives a base username (first-initial + last name, lowercased, alphanumeric-only) from a user's name; `createUser` resolves collisions by retrying with numeric suffixes via `onConflictDoNothing`. All three user-creation paths (self-registration, admin CSV/XLSX/PDF import, the `seed-admin` script) funnel through this one `createUser`.

**Tech Stack:** Express + Drizzle ORM (PostgreSQL) on the backend, React + Vitest on the frontend, Node's built-in `node:test` runner on the backend.

## Global Constraints

- This is a dev-only database — no migration path for existing rows. Schema changes go through `npm run db:push` (dev) and `npm run db:push:test` (test), never hand-written SQL.
- Username base: lowercase, alphanumeric-only, `firstName[0] + lastName`. Empty-after-stripping falls back to `"user"`.
- Collisions resolve with numeric suffixes starting at 2 (`jdoe`, `jdoe2`, `jdoe3`, ...), never a second-initial scheme. Cap retries at 1000 attempts, then throw.
- `firstName`/`lastName` stay nullable columns (the profile edit form can still blank them), but every creation path requires both non-empty at the point of creation.
- Admin bulk import keeps a dedup/"skipped" concept, now keyed on an exact case-insensitive firstName+lastName match instead of email.
- `seed-admin.ts` is insert-only (no upsert-by-identifier) since the identifier is now auto-generated.
- CSS class names that happen to contain "email" (e.g. `.account-email`, `.sidebar-footer-email`) are left as-is — purely cosmetic, not part of this change.
- Backend tests run with `node --import tsx --env-file=.env.test --test --test-concurrency=1 "src/**/*.test.ts"` from `backend/`. Frontend tests run with the repo's existing `vitest` setup from `frontend/`.
- All `sed` commands below are written for macOS/BSD sed (`sed -i ''`), matching this machine.

---

### Task 1: Schema — drop `email`, add `username`

**Files:**
- Modify: `backend/src/models/schema.ts:14-26`

**Interfaces:**
- Produces: `users.username: text, notNull, unique` column, replacing `users.email`. `User` type (`typeof users.$inferSelect`) now has `username: string` instead of `email: string`.

- [ ] **Step 1: Edit the `users` table definition**

In `backend/src/models/schema.ts`, replace:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased and trimmed; see normalizeEmail(). */
  email: text('email').notNull().unique(),
  /** Only set for admin-seeded users today; self-registered users have none. */
  firstName: text('first_name'),
  lastName: text('last_name'),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

with:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Generated at creation time from first/last name; see buildBaseUsername() in lib/username.ts. */
  username: text('username').notNull().unique(),
  /** Required at every creation path; left nullable so the profile edit form can still blank it later. */
  firstName: text('first_name'),
  lastName: text('last_name'),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push the schema to the dev and test databases**

Run from `backend/`:
```bash
npm run db:push
npm run db:push:test
```
Expected: both commands report the `users` table changed (drop `email` column/constraint, add `username` column/constraint) and prompt-free (drizzle-kit may ask to confirm a column rename vs. drop+add — choose **drop column / add column**, not rename, since this is a semantic change, not a rename).

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/schema.ts
git commit -m "feat: replace users.email with users.username in schema"
```

---

### Task 2: Username generation helper

**Files:**
- Create: `backend/src/lib/username.ts`
- Test: `backend/src/lib/username.test.ts`

**Interfaces:**
- Produces: `buildBaseUsername(firstName: string, lastName: string): string`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/username.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseUsername } from './username.ts';

test('builds first-initial + last-name, lowercased', () => {
  assert.equal(buildBaseUsername('Jane', 'Doe'), 'jdoe');
});

test('strips punctuation and spaces', () => {
  assert.equal(buildBaseUsername('John', "O'Brien"), 'jobrien');
});

test('strips spaces in multi-word last names', () => {
  assert.equal(buildBaseUsername('Jane', 'Van Der Berg'), 'jvanderberg');
});

test('falls back to "user" when stripping leaves nothing', () => {
  assert.equal(buildBaseUsername('...', '!!!'), 'user');
});

test('only uses the first character of the first name', () => {
  assert.equal(buildBaseUsername('Jonathan', 'Smith'), 'jsmith');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/username.test.ts`
Expected: FAIL — `Cannot find module './username.ts'` (or similar).

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/username.ts`:

```ts
const NON_ALPHANUMERIC = /[^a-z0-9]/g;

function stripToAlphanumeric(value: string): string {
  return value.toLowerCase().replace(NON_ALPHANUMERIC, '');
}

/** First-initial + last name, lowercased and stripped to alphanumeric. Falls
 *  back to "user" if nothing alphanumeric survives (e.g. punctuation-only
 *  names). Collision handling (numeric suffixes) lives in user.model.ts. */
export function buildBaseUsername(firstName: string, lastName: string): string {
  const base = stripToAlphanumeric(firstName.slice(0, 1)) + stripToAlphanumeric(lastName);
  return base === '' ? 'user' : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/username.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/username.ts backend/src/lib/username.test.ts
git commit -m "feat: add buildBaseUsername helper"
```

---

### Task 3: `user.model.ts` — username-based createUser, lookups

**Files:**
- Modify: `backend/src/models/user.model.ts` (full rewrite below)
- Modify: `backend/src/models/user.model.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: `buildBaseUsername(firstName, lastName): string` from Task 2.
- Produces:
  - `type PublicUser = Pick<User, 'id' | 'username' | 'firstName' | 'lastName' | 'role' | 'createdAt'>`
  - `createUser(firstName: string, lastName: string, passwordHash: string, role?: 'user' | 'admin'): Promise<PublicUser>` — always succeeds (never returns null).
  - `findUserByName(firstName: string, lastName: string): Promise<PublicUser | null>` — case-insensitive exact match.
  - `findUserByUsernameWithHash(username: string): Promise<(PublicUser & { passwordHash: string }) | null>`
  - `findUserByIdWithHash(id: string): Promise<(PublicUser & { passwordHash: string }) | null>` (unchanged signature)
  - `updateName(id, updates): Promise<PublicUser | null>` (unchanged signature)
  - `updatePasswordHash(id, passwordHash): Promise<void>` (unchanged signature)

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/models/user.model.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  updateName,
} from './user.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('createUser defaults role to "user"', async () => {
  const user = await createUser('Role', 'Default', 'hash');
  assert.equal(user.role, 'user');
});

test('createUser generates a username from first/last name', async () => {
  const user = await createUser('Jane', 'Doe', 'hash');
  assert.equal(user.username, 'jdoe');
});

test('createUser appends a number when the base username is taken', async () => {
  const first = await createUser('Jane', 'Doe', 'hash');
  const second = await createUser('Jane', 'Doe', 'hash');
  assert.equal(first.username, 'jdoe');
  assert.equal(second.username, 'jdoe2');
});

test('findUserByUsernameWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup', 'some-hash');
  const found = await findUserByUsernameWithHash(user.username);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByUsernameWithHash returns null for an unknown username', async () => {
  const found = await findUserByUsernameWithHash('nobody');
  assert.equal(found, null);
});

test('findUserByIdWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup2', 'some-hash');
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByIdWithHash returns null for an unknown id', async () => {
  const found = await findUserByIdWithHash('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});

test('findUserByName matches case-insensitively', async () => {
  await createUser('Jane', 'Doe', 'hash');
  const found = await findUserByName('jane', 'DOE');
  assert.equal(found?.firstName, 'Jane');
});

test('findUserByName returns null when no match exists', async () => {
  const found = await findUserByName('Nobody', 'Here');
  assert.equal(found, null);
});

test('updatePasswordHash persists the new hash', async () => {
  const user = await createUser('Update', 'Hash', 'old-hash');
  await updatePasswordHash(user.id, 'new-hash');
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'new-hash');
});

test('createUser stores first/last name and role', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'admin');
  assert.equal(user.firstName, 'Jane');
  assert.equal(user.lastName, 'Doe');
  assert.equal(user.role, 'admin');
});

test('updateName sets first and last name', async () => {
  const user = await createUser('Rename', 'Me', 'hash');
  const updated = await updateName(user.id, { firstName: 'Jane', lastName: 'Doe' });
  assert.equal(updated?.firstName, 'Jane');
  assert.equal(updated?.lastName, 'Doe');
});

test('updateName clears a name back to null', async () => {
  const user = await createUser('Clear', 'Name', 'hash');
  const updated = await updateName(user.id, { firstName: null, lastName: null });
  assert.equal(updated?.firstName, null);
  assert.equal(updated?.lastName, null);
});

test('updateName with only firstName leaves lastName untouched', async () => {
  const user = await createUser('Partial', 'Update', 'hash');
  const updated = await updateName(user.id, { firstName: 'Janet' });
  assert.equal(updated?.firstName, 'Janet');
  assert.equal(updated?.lastName, 'Update');
});

test('updateName with no keys leaves both names untouched and returns the current user', async () => {
  const user = await createUser('Empty', 'Update', 'hash');
  const updated = await updateName(user.id, {});
  assert.equal(updated?.firstName, 'Empty');
  assert.equal(updated?.lastName, 'Update');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/models/user.model.test.ts`
Expected: FAIL — `createUser` still has the old `(email, passwordHash, firstName?, lastName?, role?)` signature; type errors / runtime failures.

- [ ] **Step 3: Rewrite the implementation**

Replace the full contents of `backend/src/models/user.model.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { buildBaseUsername } from '../lib/username.ts';
import { users, type User } from './schema.ts';

/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<User, 'id' | 'username' | 'firstName' | 'lastName' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};

const MAX_USERNAME_ATTEMPTS = 1000;

/**
 * Generates a unique username from first/last name and inserts the user.
 * Tries the base username first, then `${base}2`, `${base}3`, ... on
 * conflict. Never returns null — a name collision changes the generated
 * username, it does not block creation.
 */
export async function createUser(
  firstName: string,
  lastName: string,
  passwordHash: string,
  role: 'user' | 'admin' = 'user',
): Promise<PublicUser> {
  const base = buildBaseUsername(firstName, lastName);

  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt++) {
    const username = attempt === 1 ? base : `${base}${attempt}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash, firstName, lastName, role })
      .onConflictDoNothing({ target: users.username })
      .returning(publicColumns);

    if (user) return user;
  }

  throw new Error(`Could not generate a unique username for base "${base}" after ${MAX_USERNAME_ATTEMPTS} attempts`);
}

/**
 * Used by the profile name-edit form. Only the columns present in `updates`
 * are written — an omitted key leaves that column untouched, while an
 * explicit `null` clears it. This is a true partial update: callers must
 * only include the keys they actually intend to change.
 */
export async function updateName(
  id: string,
  updates: { firstName?: string | null; lastName?: string | null },
): Promise<PublicUser | null> {
  if (Object.keys(updates).length === 0) {
    const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning(publicColumns);

  return user ?? null;
}

/** Case-insensitive exact match on first+last name — used by the admin
 *  import's dedup check. Returns null if either name is unset on a row. */
export async function findUserByName(firstName: string, lastName: string): Promise<PublicUser | null> {
  const [user] = await db
    .select(publicColumns)
    .from(users)
    .where(
      and(
        sql`lower(${users.firstName}) = lower(${firstName})`,
        sql`lower(${users.lastName}) = lower(${lastName})`,
      ),
    )
    .limit(1);

  return user ?? null;
}

/** Includes the password hash — only the login path should call this. */
export async function findUserByUsernameWithHash(
  username: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  return user ?? null;
}

/** Includes the password hash — only the change-password path should call this. */
export async function findUserByIdWithHash(
  id: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/models/user.model.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/models/user.model.test.ts
git commit -m "feat: generate usernames in createUser, replace email lookups"
```

---

### Task 4: `session.model.ts` and `admin-user.model.ts` — swap columns

**Files:**
- Modify: `backend/src/models/session.model.ts:16-32`
- Modify: `backend/src/models/admin-user.model.ts:7-14`
- Modify: `backend/src/models/admin-user.model.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: `PublicUser` from Task 3 (now has `username` not `email`).
- Produces: no new exports — same function signatures, different selected column.

- [ ] **Step 1: Edit `session.model.ts`**

Replace the `findUserBySessionId` select block:

```ts
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      createdAt: users.createdAt,
    })
```

with:

```ts
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      createdAt: users.createdAt,
    })
```

- [ ] **Step 2: Edit `admin-user.model.ts`**

Replace:

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

with:

```ts
const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};
```

- [ ] **Step 3: Rewrite `admin-user.model.test.ts`**

Replace the full contents of `backend/src/models/admin-user.model.test.ts`:

```ts
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { users } from './schema.ts';
import { countUsers, listUsers } from './admin-user.model.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function seedUsers(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    username: `user${String(i).padStart(3, '0')}`,
    passwordHash: 'hash',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  }));
  await db.insert(users).values(rows);
}

test('listUsers returns PAGE_SIZE rows for page 1 and the remainder for page 2', async () => {
  const total = PAGE_SIZE + 5;
  await seedUsers(total);

  const page1 = await listUsers(1);
  const page2 = await listUsers(2);

  assert.equal(page1.length, PAGE_SIZE);
  assert.equal(page2.length, 5);
  assert.equal(page1[0]!.username, 'user000');
  assert.equal(page2[0]!.username, `user${String(PAGE_SIZE).padStart(3, '0')}`);
});

test('countUsers returns the total row count regardless of page size', async () => {
  await seedUsers(PAGE_SIZE + 5);
  assert.equal(await countUsers(), PAGE_SIZE + 5);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/models/admin-user.model.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/session.model.ts backend/src/models/admin-user.model.ts backend/src/models/admin-user.model.test.ts
git commit -m "feat: select username instead of email in session/admin-user models"
```

---

### Task 5: `auth.middleware.test.ts` — update the `PublicUser` fixtures

**Files:**
- Modify: `backend/src/middleware/auth.middleware.test.ts:17-37`

**Interfaces:**
- Consumes: `PublicUser` from Task 3.

- [ ] **Step 1: Edit the fixture functions**

Replace:

```ts
function adminUser(): PublicUser {
  return {
    id: 'u1',
    email: 'admin@example.com',
    firstName: null,
    lastName: null,
    role: 'admin',
    createdAt: new Date(),
  };
}

function plainUser(): PublicUser {
  return {
    id: 'u2',
    email: 'user@example.com',
    firstName: null,
    lastName: null,
    role: 'user',
    createdAt: new Date(),
  };
}
```

with:

```ts
function adminUser(): PublicUser {
  return {
    id: 'u1',
    username: 'admin',
    firstName: null,
    lastName: null,
    role: 'admin',
    createdAt: new Date(),
  };
}

function plainUser(): PublicUser {
  return {
    id: 'u2',
    username: 'plainuser',
    firstName: null,
    lastName: null,
    role: 'user',
    createdAt: new Date(),
  };
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/middleware/auth.middleware.test.ts`
Expected: PASS, 3 tests. (This test doesn't touch the DB, so `.env.test` isn't required.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/auth.middleware.test.ts
git commit -m "test: update auth middleware fixtures to use username"
```

---

### Task 6: `auth.controller.ts` and `routes/index.ts` — username-based register/login

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts:1-65`
- Modify: `backend/src/routes/index.ts:22-24`

**Interfaces:**
- Consumes: `createUser(firstName, lastName, passwordHash, role?)`, `findUserByUsernameWithHash(username)` from Task 3.
- Produces: `POST /auth/register` body `{ firstName, lastName, password }`; `POST /auth/login` body `{ username, password }`.

- [ ] **Step 1: Edit the imports and `credentials` schema**

Replace:

```ts
import {
  createUser,
  findUserByEmailWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  updateName,
} from '../models/user.model.ts';

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
});
```

with:

```ts
import {
  createUser,
  findUserByUsernameWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  updateName,
} from '../models/user.model.ts';

const registerBody = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
});

const loginBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1).max(256),
});
```

- [ ] **Step 2: Edit `register`**

Replace:

```ts
export async function register(req: Request, res: Response): Promise<void> {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { email, password } = parsed.data;

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(email, passwordHash);

  if (!user) {
    res.status(409).json({ error: 'That email is already registered' });
    return;
  }

  await startSession(res, user.id);
  res.status(201).json({ user });
}
```

with:

```ts
export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { firstName, lastName, password } = parsed.data;

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash);

  await startSession(res, user.id);
  res.status(201).json({ user });
}
```

- [ ] **Step 3: Edit `login`**

Replace:

```ts
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately vague: don't reveal which field failed on a login attempt.
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const { email, password } = parsed.data;

  const existing = await findUserByEmailWithHash(email);
  const ok = await argon2.verify(existing?.passwordHash ?? DUMMY_HASH, password);

  if (!existing || !ok) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // Fresh session on every login — prevents session fixation.
  await startSession(res, existing.id);
  const { passwordHash: _passwordHash, ...user } = existing;
  res.json({ user });
}
```

with:

```ts
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately vague: don't reveal which field failed on a login attempt.
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  const { username, password } = parsed.data;

  const existing = await findUserByUsernameWithHash(username);
  const ok = await argon2.verify(existing?.passwordHash ?? DUMMY_HASH, password);

  if (!existing || !ok) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Fresh session on every login — prevents session fixation.
  await startSession(res, existing.id);
  const { passwordHash: _passwordHash, ...user } = existing;
  res.json({ user });
}
```

- [ ] **Step 4: Update the `changePassword` body schema reference**

The `changePasswordBody` schema (further down the file) references `credentials.shape.password`:

```ts
const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: credentials.shape.password,
});
```

Replace `credentials.shape.password` with `registerBody.shape.password`:

```ts
const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: registerBody.shape.password,
});
```

- [ ] **Step 5: Update the welcome message in `routes/index.ts`**

Replace:

```ts
apiRouter.get('/me/dashboard', requireAuth, (req: Request, res: Response) => {
  res.json({ message: `Welcome back, ${req.user!.email}` });
});
```

with:

```ts
apiRouter.get('/me/dashboard', requireAuth, (req: Request, res: Response) => {
  res.json({ message: `Welcome back, ${req.user!.username}` });
});
```

- [ ] **Step 6: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: FAIL at this point — `auth.controller.test.ts` and `test/helpers/server.ts` still use the old `{ email, password }` body shape and will be fixed in Tasks 7–8. Confirm the only errors are in those two files (and their callers); if errors appear elsewhere, stop and investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/routes/index.ts
git commit -m "feat: switch register/login to username, drop email from auth"
```

---

### Task 7: Test helper — `registerTestUser` takes a name, not an email

**Files:**
- Modify: `backend/src/test/helpers/server.ts:17-34`

**Interfaces:**
- Produces: `registerTestUser(baseUrl: string, label: string): Promise<{ cookie: string; userId: string; username: string }>` — `label` becomes the test user's `lastName` (firstName is always `'Test'`); the returned `username` is whatever `createUser` generated, so callers that need to log back in don't have to recompute it by hand.

- [ ] **Step 1: Edit `registerTestUser`**

Replace:

```ts
/** Registers a user and returns the session cookie to send on later requests. */
export async function registerTestUser(
  baseUrl: string,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('register returned no cookie');
  const body = (await res.json()) as { user: { id: string } };
  return { cookie: setCookie.split(';')[0]!, userId: body.user.id };
}
```

with:

```ts
/**
 * Registers a user and returns the session cookie to send on later requests.
 * `label` becomes the generated user's last name (first name is always
 * "Test"); the returned `username` is whatever createUser generated, so
 * callers that need to log back in can use it without recomputing it.
 */
export async function registerTestUser(
  baseUrl: string,
  label: string,
): Promise<{ cookie: string; userId: string; username: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: label, password: 'test-password-123' }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('register returned no cookie');
  const body = (await res.json()) as { user: { id: string; username: string } };
  return { cookie: setCookie.split(';')[0]!, userId: body.user.id, username: body.user.username };
}
```

- [ ] **Step 2: Sweep every call site that just needs `@example.com` stripped**

The following files call `registerTestUser(baseUrl, 'xxx@example.com')` purely for test-fixture identity — none of them read or assert on the label's value, so stripping the `@example.com` suffix is the only change they need. Run from the repo root:

```bash
cd backend/src/controllers
sed -i '' -E "s/registerTestUser\(baseUrl, '([a-zA-Z0-9.-]+)@example\.com'\)/registerTestUser(baseUrl, '\1')/g" \
  quiz.controller.test.ts \
  progress.test.ts \
  attempt.controller.test.ts \
  catalog.controller.test.ts \
  grading.test.ts \
  admin-import.controller.test.ts
cd ../../..
```

- [ ] **Step 3: Verify the sweep didn't miss or mis-match anything**

Run: `cd backend && grep -rn "@example.com" src/controllers/quiz.controller.test.ts src/controllers/progress.test.ts src/controllers/attempt.controller.test.ts src/controllers/catalog.controller.test.ts src/controllers/grading.test.ts src/controllers/admin-import.controller.test.ts`
Expected: no output (no remaining `@example.com` strings in these six files).

- [ ] **Step 4: Run the affected test files**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/quiz.controller.test.ts src/controllers/progress.test.ts src/controllers/attempt.controller.test.ts src/controllers/catalog.controller.test.ts src/controllers/grading.test.ts src/controllers/admin-import.controller.test.ts`
Expected: PASS, all tests across all six files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/test/helpers/server.ts backend/src/controllers/quiz.controller.test.ts backend/src/controllers/progress.test.ts backend/src/controllers/attempt.controller.test.ts backend/src/controllers/catalog.controller.test.ts backend/src/controllers/grading.test.ts backend/src/controllers/admin-import.controller.test.ts
git commit -m "test: registerTestUser takes a name label instead of an email"
```

---

### Task 8: `auth.controller.test.ts` — rewrite for username login

**Files:**
- Modify: `backend/src/controllers/auth.controller.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: `registerTestUser(baseUrl, label)` returning `{ cookie, userId, username }` from Task 7.

- [ ] **Step 1: Replace the full file contents**

Replace the full contents of `backend/src/controllers/auth.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';

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

test('POST /api/v1/auth/login returns the role, not just id/username/createdAt', async () => {
  const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Login', lastName: 'Role', password: 'test-password-123' }),
  });
  const { user: registered } = (await registerRes.json()) as { user: { username: string } };

  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: registered.username, password: 'test-password-123' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string; passwordHash?: string } };
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.passwordHash, undefined);
});

test('PATCH /api/v1/auth/password rejects a wrong current password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'PwWrong');

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/password rejects a too-short new password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'PwShort');

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/v1/auth/password requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/password changes the password, revokes other sessions, keeps this one', async () => {
  const { cookie, username } = await registerTestUser(baseUrl, 'PwChange');

  // A second "device": log in again to get an independent session cookie.
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test-password-123' }),
  });
  const otherCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-456' }),
  });
  assert.equal(res.status, 204);
  const newCookie = res.headers.get('set-cookie')!.split(';')[0]!;

  // The other device's session is revoked.
  const otherMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: otherCookie } });
  assert.equal(otherMe.status, 401);

  // This device's *old* cookie is revoked too (it was swapped for a fresh one).
  const oldMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(oldMe.status, 401);

  // This device continues on the newly issued cookie.
  const newMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: newCookie } });
  assert.equal(newMe.status, 200);

  // The new password actually works for a fresh login.
  const relogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'new-password-456' }),
  });
  assert.equal(relogin.status, 200);
});

test('PATCH /api/v1/auth/name requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/name updates and returns the user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameUpdate');

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/v1/auth/name clears a name when given blank strings', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameClear');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: '' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, null);
  assert.equal(body.user.lastName, null);
});

test('PATCH /api/v1/auth/name with only firstName in the body does not clear lastName', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NamePartial');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Janet' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Janet');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/v1/auth/name rejects a name over 100 characters', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameTooLong');

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'a'.repeat(101) }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/v1/auth/name with an empty body leaves both names unchanged', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameEmptyBody');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('POST /api/v1/auth/register rejects a missing first or last name', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: 'Doe', password: 'test-password-123' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/v1/auth/register with a duplicate name still succeeds, with a numbered username', async () => {
  const first = await registerTestUser(baseUrl, 'Duplicate');
  const secondRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'Duplicate', password: 'test-password-123' }),
  });
  assert.equal(secondRes.status, 201);
  const body = (await secondRes.json()) as { user: { username: string } };
  assert.notEqual(body.user.username, first.username);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/auth.controller.test.ts`
Expected: PASS, all tests.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/auth.controller.test.ts
git commit -m "test: rewrite auth.controller.test.ts for username login"
```

---

### Task 9: `admin-users.controller.test.ts` — rewrite for username

**Files:**
- Modify: `backend/src/controllers/admin-users.controller.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: `registerTestUser(baseUrl, label)` from Task 7; admin users list/response shape now has `username` instead of `email`.

- [ ] **Step 1: Replace the full file contents**

Replace the full contents of `backend/src/controllers/admin-users.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';

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

async function makeAdmin(label: string) {
  const { cookie, userId, username } = await registerTestUser(baseUrl, label);
  await setUserRole(userId, 'admin');
  return { cookie, userId, username };
}

test('GET /api/v1/admin/users 404s for a signed-in non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('GET /api/v1/admin/users lists users for an admin', async () => {
  const { cookie, username: adminUsername } = await makeAdmin('Admin');
  const { username: studentUsername } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ username: string }> };
  const usernames = body.items.map((u) => u.username).sort();
  assert.deepEqual(usernames, [adminUsername, studentUsername].sort());
});

test('GET /api/v1/admin/users includes pagination metadata', async () => {
  const { cookie } = await makeAdmin('Admin');
  await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await res.json()) as { total: number; page: number; pageSize: number };
  assert.equal(body.total, 2);
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 20);
});

test('PATCH role promotes a user to admin', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string } };
  assert.equal(body.user.role, 'admin');
});

test('PATCH role rejects an admin demoting themselves', async () => {
  const { cookie, userId } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE removes a user', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { items: Array<{ username: string }> };
  assert.equal(body.items.some((u) => u.username === username), false);
});

test('DELETE rejects an admin deleting themselves', async () => {
  const { cookie, userId } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});

test("GET /api/v1/admin/users/:id/attempts lists that user's attempts", async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  // The student has no course content seeded in this test's empty DB, so this
  // only exercises the empty-list path — content-bearing cases are covered by
  // the quiz/attempt lifecycle tests elsewhere.
  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/attempts`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attempts: unknown[] };
  assert.deepEqual(body.attempts, []);
});

test('GET /api/v1/admin/users/:id/attempts 404s for an unknown user', async () => {
  const { cookie } = await makeAdmin('Admin');
  const res = await fetch(
    `${baseUrl}/api/v1/admin/users/00000000-0000-0000-0000-000000000000/attempts`,
    { headers: { cookie } },
  );
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/admin-users.controller.test.ts`
Expected: PASS, all tests.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/admin-users.controller.test.ts
git commit -m "test: rewrite admin-users.controller.test.ts for username"
```

---

### Task 10: `user-import-parser.ts` — drop email, require first/last name

**Files:**
- Modify: `backend/src/lib/user-import-parser.ts` (full rewrite below)
- Modify: `backend/src/lib/user-import-parser.test.ts` (full rewrite below)

**Interfaces:**
- Produces: `ParsedUserRow = { row: number; firstName: string; lastName: string; role: Role }` (both names now required, non-nullable; `email` field removed). `parseUserRows(file)` unchanged signature.

- [ ] **Step 1: Replace the full test file contents**

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/lib/user-import-parser.test.ts`
Expected: FAIL — the implementation still has the email-based column checks and `ParsedUserRow` shape.

- [ ] **Step 3: Rewrite the implementation**

Replace the full contents of `backend/src/lib/user-import-parser.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/lib/user-import-parser.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/user-import-parser.ts backend/src/lib/user-import-parser.test.ts
git commit -m "feat: drop email from user import parsing, require first/last name"
```

---

### Task 11: `admin-user-import.controller.ts` — username + name-based dedup

**Files:**
- Modify: `backend/src/controllers/admin-user-import.controller.ts` (full rewrite below)
- Modify: `backend/src/controllers/admin-user-import.controller.test.ts` (full rewrite below)

**Interfaces:**
- Consumes: `createUser(firstName, lastName, passwordHash, role?)`, `findUserByName(firstName, lastName)` from Task 3; `registerTestUser(baseUrl, label)` from Task 7.
- Produces: `POST /admin/users/import/confirm` response `{ created: Array<{ username, firstName, lastName, role, password }>, skipped: Array<{ firstName, lastName, reason }> }`.

- [ ] **Step 1: Rewrite the controller**

Replace the full contents of `backend/src/controllers/admin-user-import.controller.ts`:

```ts
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseUserRows } from '../lib/user-import-parser.ts';
import { createUser, findUserByName } from '../models/user.model.ts';

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
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
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
    username: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    password: string;
  }> = [];
  const skipped: Array<{ firstName: string | null; lastName: string | null; reason: string }> = [];

  for (const row of parsed.data.rows) {
    const existing = await findUserByName(row.firstName, row.lastName);
    if (existing) {
      skipped.push({ firstName: row.firstName, lastName: row.lastName, reason: 'already registered' });
      continue;
    }

    const password = generatePassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await createUser(row.firstName, row.lastName, passwordHash, row.role);

    created.push({
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      password,
    });
  }

  res.json({ created, skipped });
}
```

- [ ] **Step 2: Replace the full test file contents**

Replace the full contents of `backend/src/controllers/admin-user-import.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { findUserByUsernameWithHash } from '../models/user.model.ts';

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
  const { cookie, userId } = await registerTestUser(baseUrl, 'Admin');
  await setUserRole(userId, 'admin');
  return cookie;
}

function csvForm(csv: string, filename = 'students.csv') {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  return form;
}

test('POST /api/v1/admin/users/import/parse returns rows and errors for a csv', async () => {
  const cookie = await adminCookie();
  const csv = 'First Name,Last Name,Role\nJane,Doe,admin\n,Roe,\n';

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csv),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    rows: Array<{ firstName: string; lastName: string }>;
    errors: Array<{ row: number }>;
  };
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0]?.firstName, 'Jane');
  assert.equal(body.rows[0]?.lastName, 'Doe');
  assert.equal(body.errors.length, 1);
});

test('POST /api/v1/admin/users/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm('First Name,Last Name\nA,B\n'),
  });
  assert.equal(res.status, 404);
});

test('POST /api/v1/admin/users/import/confirm creates users with a hashed password', async () => {
  const cookie = await adminCookie();
  const rows = [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'admin' as const }];

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{
      username: string;
      firstName: string | null;
      lastName: string | null;
      role: string;
      password: string;
    }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.username, 'jdoe');
  assert.equal(body.created[0]?.firstName, 'Jane');
  assert.equal(body.created[0]?.lastName, 'Doe');
  assert.equal(body.created[0]?.role, 'admin');
  assert.ok(body.created[0]?.password && body.created[0].password.length > 0);
  assert.deepEqual(body.skipped, []);

  const stored = await findUserByUsernameWithHash('jdoe');
  assert.notEqual(stored?.passwordHash, body.created[0]?.password);
});

test('POST /api/v1/admin/users/import/confirm skips a row matching an existing user by name', async () => {
  const cookie = await adminCookie();
  await registerTestUser(baseUrl, 'Existing');

  const rows = [{ row: 2, firstName: 'Test', lastName: 'Existing', role: 'user' as const }];
  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: unknown[];
    skipped: Array<{ firstName: string | null; lastName: string | null; reason: string }>;
  };
  assert.deepEqual(body.created, []);
  assert.equal(body.skipped[0]?.firstName, 'Test');
  assert.equal(body.skipped[0]?.lastName, 'Existing');
});

test('a 150-row parse-then-confirm round trip creates every row', async () => {
  const cookie = await adminCookie();
  const csvLines = ['First Name,Last Name,Role'];
  for (let i = 0; i < 150; i++) {
    csvLines.push(`User,${i},user`);
  }

  const parseRes = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csvLines.join('\n') + '\n'),
  });
  assert.equal(parseRes.status, 200);
  const parsed = (await parseRes.json()) as {
    rows: Array<{ row: number; firstName: string; lastName: string; role: string }>;
    errors: unknown[];
  };
  assert.equal(parsed.rows.length, 150);
  assert.deepEqual(parsed.errors, []);

  const confirmRes = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: parsed.rows }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmed = (await confirmRes.json()) as { created: unknown[]; skipped: unknown[] };
  assert.equal(confirmed.created.length, 150);
  assert.deepEqual(confirmed.skipped, []);
});

test('POST /api/v1/admin/users/import/confirm rejects more than 200 rows', async () => {
  const cookie = await adminCookie();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    row: i + 2,
    firstName: `User ${i}`,
    lastName: 'Test',
    role: 'user' as const,
  }));

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
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
    role: 'user' as const,
  }));

  const body = JSON.stringify({ rows });
  assert.ok(Buffer.byteLength(body) > 100 * 1024, 'test body should exceed 100KB');
  assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024, 'test body should stay under 2MB');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body,
  });
  assert.equal(res.status, 200);
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/admin-user-import.controller.test.ts`
Expected: PASS, all 7 tests. (The 201-row rejection and the 200-row-padding tests all share base username `utest` across every row — each insert retries up to 200 times via the numbered-suffix loop, which is within the 1000-attempt cap from Task 3; this is expected to be slightly slower than other tests but still complete well under the test runner's default timeout.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin-user-import.controller.ts backend/src/controllers/admin-user-import.controller.test.ts
git commit -m "feat: dedup admin user import on name, report usernames"
```

---

### Task 12: `seed-admin.ts` — name-based, insert-only, defaulted password

**Files:**
- Modify: `backend/src/scripts/seed-admin.ts` (full rewrite below)

**Interfaces:**
- Consumes: `createUser(firstName, lastName, passwordHash, role?)` from Task 3.

- [ ] **Step 1: Rewrite the script**

Replace the full contents of `backend/src/scripts/seed-admin.ts`:

```ts
import argon2 from 'argon2';
import { pool } from '../db/index.ts';
import { createUser } from '../models/user.model.ts';

/**
 * Creates a new admin user from first/last name. Insert-only: unlike the old
 * email-keyed version, this can't safely upsert, because the identifier
 * (username) is generated from the name rather than supplied — re-running
 * with the same name would either silently promote an unrelated existing
 * user or just create a second account. Re-running this script always
 * creates a new admin.
 */
export async function seedAdmin(firstName: string, lastName: string, password: string): Promise<string> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, 'admin');
  return user.username;
}

async function main(): Promise<void> {
  const firstName = process.env.ADMIN_FIRST_NAME;
  const lastName = process.env.ADMIN_LAST_NAME;
  const password = process.env.ADMIN_PASSWORD ?? 'liahwellness';

  if (!firstName || !lastName) {
    console.error('Set ADMIN_FIRST_NAME and ADMIN_LAST_NAME, then re-run.');
    process.exit(1);
  }

  const username = await seedAdmin(firstName, lastName, password);
  console.log(`Admin ready: ${username}`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 2: Smoke-test the script manually**

Run from `backend/`:
```bash
ADMIN_FIRST_NAME=Test ADMIN_LAST_NAME=Admin node --import tsx --env-file-if-exists=.env src/scripts/seed-admin.ts
```
Expected: prints `Admin ready: tadmin` and exits 0. Confirm the row exists:
```bash
node --import tsx --env-file-if-exists=.env -e "
import { db } from './src/db/index.ts';
import { users } from './src/models/schema.ts';
console.log(await db.select().from(users));
process.exit(0);
"
```
Expected: one row with `username: 'tadmin'`, `role: 'admin'`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/scripts/seed-admin.ts
git commit -m "feat: seed-admin takes first/last name, defaults password to liahwellness"
```

---

### Task 13: Frontend auth core — `api.ts`, `context.ts`, `AuthProvider.tsx`, `LoginForm.tsx`

**Files:**
- Modify: `frontend/src/auth/api.ts:4-33`
- Modify: `frontend/src/auth/context.ts:4-12`
- Modify: `frontend/src/auth/AuthProvider.tsx:33-41`
- Modify: `frontend/src/auth/LoginForm.tsx` (full rewrite below)

**Interfaces:**
- Produces: `User.username: string` (replacing `email`); `authApi.login(username, password)`; `authApi.register(firstName, lastName, password)`; `AuthState.login(username, password)`; `AuthState.register(firstName, lastName, password)`.

- [ ] **Step 1: Edit `auth/api.ts`**

Replace:

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

with:

```ts
export type User = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  createdAt: string;
};
```

Replace:

```ts
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
```

with:

```ts
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (firstName: string, lastName: string, password: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, password }),
    }),
```

- [ ] **Step 2: Edit `auth/context.ts`**

Replace:

```ts
export type AuthState = {
  user: User | null;
  /** True until the initial /auth/me check settles. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
};
```

with:

```ts
export type AuthState = {
  user: User | null;
  /** True until the initial /auth/me check settles. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (firstName: string, lastName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
};
```

- [ ] **Step 3: Edit `auth/AuthProvider.tsx`**

Replace:

```ts
  const login = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.login(email, password);
    setUser(user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.register(email, password);
    setUser(user);
  }, []);
```

with:

```ts
  const login = useCallback(async (username: string, password: string) => {
    const { user } = await authApi.login(username, password);
    setUser(user);
  }, []);

  const register = useCallback(async (firstName: string, lastName: string, password: string) => {
    const { user } = await authApi.register(firstName, lastName, password);
    setUser(user);
  }, []);
```

- [ ] **Step 4: Rewrite `LoginForm.tsx`**

Replace the full contents of `frontend/src/auth/LoginForm.tsx`:

```tsx
import { useState, type SubmitEvent } from 'react';
import liahLogo from '../assets/liah-logo.png';
import { MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register';

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await (mode === 'login' ? login(username, password) : register(firstName, lastName, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-head">
          <img src={liahLogo} alt="LIAH Learning" className="auth-mark" />
          <h1>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h1>
        </header>

        <form onSubmit={handleSubmit} className="auth-form">
          {/* The fields read as one control: a shared outline with the
              shared edges collapsed, so the group looks joined rather than
              stacked. Labels are visually replaced by placeholders, so each
              input carries an aria-label for screen readers. */}
          <div className="auth-fields">
            {mode === 'login' ? (
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                aria-label="Username"
                autoComplete="username"
                required
              />
            ) : (
              <>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  aria-label="First name"
                  autoComplete="given-name"
                  required
                />
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  aria-label="Last name"
                  autoComplete="family-name"
                  required
                />
              </>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              // Only constrain when choosing a password. On sign-in the server is
              // the authority, and a native "lengthen this text" popup would just
              // get in the way of a legitimate attempt.
              minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
              required
            />
          </div>

          {mode === 'register' && (
            <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
          )}

          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? 'Not a member yet?' : 'Already registered?'}{' '}
          <button
            type="button"
            className="auth-toggle"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck` (or `npx tsc -p tsconfig.json --noEmit` if there is no dedicated script — check `frontend/package.json` for the exact script name first)
Expected: FAIL at this point — every file touched in Tasks 14–15 still references `user.email`. Confirm the only errors are in `AppShell.tsx`, `SidebarNav.tsx`, `AccountMenu.tsx`, `ProfilePage.tsx`, `admin/api.ts`, `AdminUsersPage.tsx`, and their tests; if errors appear elsewhere, stop and investigate.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/auth/context.ts frontend/src/auth/AuthProvider.tsx frontend/src/auth/LoginForm.tsx
git commit -m "feat: switch frontend login/register to username and first/last name"
```

---

### Task 14: Frontend tests referencing `email` structurally (no display assertions)

**Files:**
- Modify: `frontend/src/auth/logout-navigation.test.tsx:11`
- Modify: `frontend/src/router.test.tsx:16,66`
- Modify: `frontend/src/router.admin-guard.test.tsx:21,27`

**Interfaces:**
- Consumes: `User.username` from Task 13. These three files only use the mocked user object to satisfy the `User` type / drive role-based branching — none of them assert on the identifier's displayed text, so the rename is a pure field-name-and-value substitution.

- [ ] **Step 1: Edit `logout-navigation.test.tsx:11`**

Replace:
```tsx
        user: { id: 'u1', email: 'a@b.com', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
```
with:
```tsx
        user: { id: 'u1', username: 'absmith', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
```

- [ ] **Step 2: Edit `router.test.tsx:16` and `:66`**

Both lines are identical:
```tsx
    user: { id: 'u1', email: 'a@b.com', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
```
Replace both occurrences (use `replace_all` if using the Edit tool) with:
```tsx
    user: { id: 'u1', username: 'absmith', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
```

- [ ] **Step 3: Edit `router.admin-guard.test.tsx:21` and `:27`**

Replace:
```tsx
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'admin' }, loading: false });
```
with:
```tsx
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'absmith', role: 'admin' }, loading: false });
```
Replace:
```tsx
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'user' }, loading: false });
```
with:
```tsx
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'absmith', role: 'user' }, loading: false });
```

- [ ] **Step 4: Run the three test files**

Run: `cd frontend && npx vitest run src/auth/logout-navigation.test.tsx src/router.test.tsx src/router.admin-guard.test.tsx`
Expected: PASS, all tests across all three files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth/logout-navigation.test.tsx frontend/src/router.test.tsx frontend/src/router.admin-guard.test.tsx
git commit -m "test: rename email to username in router/logout test fixtures"
```

---

### Task 15: Frontend display — `AppShell.tsx`, `SidebarNav.tsx`, `AccountMenu.tsx`, `ProfilePage.tsx`

**Files:**
- Modify: `frontend/src/shell/AppShell.tsx:92-100`
- Modify: `frontend/src/shell/SidebarNav.tsx:76-137`
- Modify: `frontend/src/shell/AccountMenu.tsx` (full rewrite below)
- Modify: `frontend/src/pages/ProfilePage.tsx:90-96`
- Modify: `frontend/src/shell/AppShell.test.tsx:27,83,86`
- Modify: `frontend/src/shell/AccountMenu.test.tsx` (full rewrite below)
- Modify: `frontend/src/pages/ProfilePage.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `User.username` from Task 13.
- Produces: `AccountMenu({ username, role, onLogout })` (renamed from `email`); `SidebarNav({ nav, username, onNavigate })` (renamed from `userEmail`).
- CSS class names `account-email` / `sidebar-footer-email` are left unchanged (cosmetic only, per Global Constraints).

- [ ] **Step 1: Edit `AccountMenu.tsx`**

Replace the full contents of `frontend/src/shell/AccountMenu.tsx`:

```tsx
import { useId, useState } from 'react';
import { NavLink } from 'react-router';
import { CogIcon, SignOutIcon, UserIcon } from './icons';

/**
 * The signed-in user's menu in the top navbar: account actions first
 * (Profile, Sign out), then admin-only links after a divider. One
 * disclosure rather than two separate controls, since both are "things
 * about you as a signed-in user" — admin-ness is just an extra fact about
 * that user, not a different kind of menu.
 *
 * Closes on blur leaving the whole menu (button + panel), which covers both
 * a click outside and Tab away, without a document-level listener.
 */
export function AccountMenu({
  username,
  role,
  onLogout,
}: {
  username: string;
  role: 'user' | 'admin';
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className="account-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-avatar" aria-hidden="true">
          {username.charAt(0).toUpperCase()}
        </span>
        <span className="account-email">{username}</span>
      </button>

      <ul id={panelId} className="account-menu-panel" hidden={!open}>
        <li>
          <NavLink to="/profile" className="account-menu-item" onClick={() => setOpen(false)}>
            <UserIcon className="nav-icon" />
            Profile
          </NavLink>
        </li>
        <li>
          <button
            type="button"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <SignOutIcon className="nav-icon" />
            Sign out
          </button>
        </li>

        {role === 'admin' && (
          <>
            <li className="account-menu-divider" role="separator" />
            <li>
              <NavLink to="/admin/users" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Users
              </NavLink>
            </li>
            <li>
              <NavLink to="/admin/import" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Import
              </NavLink>
            </li>
          </>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Edit `AppShell.tsx`**

Replace:
```tsx
          {user && (
            <AccountMenu email={user.email} role={user.role} onLogout={() => void handleLogout()} />
          )}
```
with:
```tsx
          {user && (
            <AccountMenu username={user.username} role={user.role} onLogout={() => void handleLogout()} />
          )}
```

Replace:
```tsx
          <SidebarNav nav={nav} userEmail={user?.email} onNavigate={close} />
```
with:
```tsx
          <SidebarNav nav={nav} username={user?.username} onNavigate={close} />
```

- [ ] **Step 3: Edit `SidebarNav.tsx`**

Replace:
```tsx
export function SidebarNav({
  nav,
  userEmail,
  onNavigate,
}: {
  nav: SubjectNavState;
  userEmail?: string;
  onNavigate?: () => void;
}) {
```
with:
```tsx
export function SidebarNav({
  nav,
  username,
  onNavigate,
}: {
  nav: SubjectNavState;
  username?: string;
  onNavigate?: () => void;
}) {
```

Replace:
```tsx
      {userEmail && (
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">
            {userEmail.charAt(0).toUpperCase()}
          </span>
          <span className="sidebar-footer-email">{userEmail}</span>
        </div>
      )}
```
with:
```tsx
      {username && (
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">
            {username.charAt(0).toUpperCase()}
          </span>
          <span className="sidebar-footer-email">{username}</span>
        </div>
      )}
```

- [ ] **Step 4: Edit `ProfilePage.tsx`**

Replace:
```tsx
          <dt>Email</dt>
          <dd>{user?.email}</dd>
```
with:
```tsx
          <dt>Username</dt>
          <dd>{user?.username}</dd>
```

- [ ] **Step 5: Edit `AppShell.test.tsx`**

Replace:
```tsx
    user: { id: 'u1', email: 'tech@example.com', createdAt: '2026-11-02T12:00:00.000Z' },
```
with:
```tsx
    user: { id: 'u1', username: 'techsmith', createdAt: '2026-11-02T12:00:00.000Z' },
```

Replace:
```tsx
    const sidebar = await nav();
    expect(within(sidebar).getByText('tech@example.com')).toBeInTheDocument();

    // Sign out lives inside the account menu, named by the user's email.
    await userEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
```
with:
```tsx
    const sidebar = await nav();
    expect(within(sidebar).getByText('techsmith')).toBeInTheDocument();

    // Sign out lives inside the account menu, named by the user's username.
    await userEvent.click(screen.getByRole('button', { name: /techsmith/ }));
```

- [ ] **Step 6: Replace the full contents of `AccountMenu.test.tsx`**

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AccountMenu } from './AccountMenu';

function renderMenu(role: 'user' | 'admin' = 'user') {
  const onLogout = vi.fn();
  render(
    <MemoryRouter>
      <AccountMenu username="techsmith" role={role} onLogout={onLogout} />
    </MemoryRouter>,
  );
  return { onLogout };
}

describe('AccountMenu', () => {
  test('the panel starts closed', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Sign out')).not.toBeVisible();
  });

  test('a plain user sees Profile and Sign out but no admin links', () => {
    renderMenu('user');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

    expect(screen.getByRole('link', { name: 'Profile' })).toBeVisible();
    expect(screen.getByText('Sign out')).toBeVisible();
    expect(screen.queryByText('Admin · Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin · Import')).not.toBeInTheDocument();
  });

  test('Profile comes before Sign out, which comes before the admin links', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    const profileIndex = items.findIndex((t) => t?.includes('Profile'));
    const signOutIndex = items.findIndex((t) => t?.includes('Sign out'));
    const usersIndex = items.findIndex((t) => t?.includes('Admin · Users'));
    const importIndex = items.findIndex((t) => t?.includes('Admin · Import'));

    expect(profileIndex).toBeLessThan(signOutIndex);
    expect(signOutIndex).toBeLessThan(usersIndex);
    expect(usersIndex).toBeLessThan(importIndex);
  });

  test('clicking Sign out calls onLogout and closes the panel', () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    fireEvent.click(screen.getByText('Sign out'));

    expect(onLogout).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking Profile links to /profile and closes the panel', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    const link = screen.getByRole('link', { name: 'Profile' });
    expect(link).toHaveAttribute('href', '/profile');

    fireEvent.click(link);
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking an admin link closes the panel', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    fireEvent.click(screen.getByRole('link', { name: /Admin · Users/ }));

    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
```

- [ ] **Step 7: Replace the full contents of `ProfilePage.test.tsx`**

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
const updateName = vi.fn();
const updateUser = vi.fn();
const useAuth = vi.fn();
const toastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: {
    changePassword: (a: string, b: string) => changePassword(a, b),
    updateName: (a: string, b: string) => updateName(a, b),
  },
}));

function mockUser(
  overrides: Partial<{
    firstName: string | null;
    lastName: string | null;
    role: 'user' | 'admin';
  }> = {},
) {
  useAuth.mockReturnValue({
    user: {
      id: 'u1',
      username: 'student',
      firstName: null,
      lastName: null,
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
      ...overrides,
    },
    updateUser,
  });
}

function openEditMode() {
  fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
}

beforeEach(() => {
  mockUser();
  changePassword.mockReset();
  updateName.mockReset();
  updateUser.mockReset();
  toastSuccess.mockReset();
});

describe('ProfilePage', () => {
  test('shows the username and em-dash name fields, but not a Role row, for a plain user', () => {
    render(<ProfilePage />);
    expect(screen.getByText('student')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  test('shows the Role row for an admin', () => {
    mockUser({ role: 'admin' });
    render(<ProfilePage />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  test('displays the current first and last name when set', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
  });

  test('clicking Edit profile reveals the form pre-filled with the current name', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    openEditMode();
    expect(screen.getByLabelText('First name')).toHaveValue('Jane');
    expect(screen.getByLabelText('Last name')).toHaveValue('Doe');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  test('Cancel discards edits and returns to read-only view without any network calls', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    openEditMode();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('saving with only the name changed calls updateName, not changePassword, and returns to read-only view', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        username: 'student',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Jane', 'Doe'));
    expect(changePassword).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      ),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Profile updated.'));
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  test('saving with both name and password filled calls both APIs and returns to read-only view', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        username: 'student',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass-123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Jane', 'Doe'));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Profile updated.'));
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  test('only one password field filled shows a validation error and calls neither API', async () => {
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(
      await screen.findByText('Enter both current and new password to change it, or leave both blank.'),
    ).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('a failed password change keeps edit mode open, applies the name change, and shows the password error', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        username: 'student',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      ),
    );
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });

  test('a failed name update stays in edit mode and shows the name error', async () => {
    updateName.mockRejectedValue(new Error('Something went wrong'));
    render(<ProfilePage />);
    openEditMode();

    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  test('clearing the first name and submitting calls updateName with an empty string', async () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        username: 'student',
        firstName: null,
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);
    openEditMode();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('', 'Doe'));
  });
});
```

- [ ] **Step 8: Run the affected test files**

Run: `cd frontend && npx vitest run src/shell/AppShell.test.tsx src/shell/AccountMenu.test.tsx src/pages/ProfilePage.test.tsx`
Expected: PASS, all tests across all three files.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/shell/AppShell.tsx frontend/src/shell/SidebarNav.tsx frontend/src/shell/AccountMenu.tsx frontend/src/pages/ProfilePage.tsx frontend/src/shell/AppShell.test.tsx frontend/src/shell/AccountMenu.test.tsx frontend/src/pages/ProfilePage.test.tsx
git commit -m "feat: display username instead of email in shell and profile"
```

---

### Task 16: Frontend admin — `admin/api.ts`, `AdminUsersPage.tsx`, their tests

**Files:**
- Modify: `frontend/src/admin/api.ts:33-48`
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx` (targeted edits below)
- Modify: `frontend/src/admin/api.test.ts:83`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `User.username` from Task 13.
- Produces: `ImportedUserRow = { row, firstName, lastName, role }` (no `email`); `ConfirmedUser = { username, firstName, lastName, role, password }`; `SkippedUser = { firstName, lastName, reason }`.

- [ ] **Step 1: Edit `admin/api.ts`**

Replace:
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
with:
```ts
export type ImportedUserRow = {
  row: number;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin';
};
export type ImportRowError = { row: number; message: string };
export type ConfirmedUser = {
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  password: string;
};
export type SkippedUser = { firstName: string | null; lastName: string | null; reason: string };
```

- [ ] **Step 2: Edit `admin/api.test.ts:83`**

Replace:
```ts
    const rows = [
      { row: 2, firstName: 'Jane', lastName: null, email: 'jane@example.com', role: 'user' as const },
    ];
```
with:
```ts
    const rows = [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' as const }];
```

- [ ] **Step 3: Edit `AdminUsersPage.tsx` — import preview table**

Replace:
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
                {parsedRows
                  .slice((previewPager.page - 1) * PAGE_SIZE, previewPager.page * PAGE_SIZE)
                  .map((r) => (
                    <tr key={r.row}>
                      <td data-label="First Name">{r.firstName ?? '—'}</td>
                      <td data-label="Last Name">{r.lastName ?? '—'}</td>
                      <td data-label="Email">{r.email}</td>
                      <td data-label="Role">{r.role}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
```
with:
```tsx
            <table className="admin-table">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows
                  .slice((previewPager.page - 1) * PAGE_SIZE, previewPager.page * PAGE_SIZE)
                  .map((r) => (
                    <tr key={r.row}>
                      <td data-label="First Name">{r.firstName}</td>
                      <td data-label="Last Name">{r.lastName}</td>
                      <td data-label="Role">{r.role}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
```

- [ ] **Step 4: Edit `AdminUsersPage.tsx` — "Created" results table and CSV export**

Replace:
```tsx
                <button
                  type="button"
                  onClick={() => {
                    const header = 'email,firstName,lastName,role,password';
                    const lines = importResults.created.map(
                      (u) => `${u.email},${u.firstName ?? ''},${u.lastName ?? ''},${u.role},${u.password}`,
                    );
                    void navigator.clipboard.writeText([header, ...lines].join('\n'));
                  }}
                >
                  Copy all as CSV
                </button>
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
                    {importResults.created
                      .slice((createdPager.page - 1) * PAGE_SIZE, createdPager.page * PAGE_SIZE)
                      .map((u) => (
                        <tr key={u.email}>
                          <td data-label="Email">{u.email}</td>
                          <td data-label="First Name">{u.firstName ?? '—'}</td>
                          <td data-label="Last Name">{u.lastName ?? '—'}</td>
                          <td data-label="Role">{u.role}</td>
                          <td data-label="Password">{u.password}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
```
with:
```tsx
                <button
                  type="button"
                  onClick={() => {
                    const header = 'username,firstName,lastName,role,password';
                    const lines = importResults.created.map(
                      (u) => `${u.username},${u.firstName ?? ''},${u.lastName ?? ''},${u.role},${u.password}`,
                    );
                    void navigator.clipboard.writeText([header, ...lines].join('\n'));
                  }}
                >
                  Copy all as CSV
                </button>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Role</th>
                      <th>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.created
                      .slice((createdPager.page - 1) * PAGE_SIZE, createdPager.page * PAGE_SIZE)
                      .map((u) => (
                        <tr key={u.username}>
                          <td data-label="Username">{u.username}</td>
                          <td data-label="First Name">{u.firstName ?? '—'}</td>
                          <td data-label="Last Name">{u.lastName ?? '—'}</td>
                          <td data-label="Role">{u.role}</td>
                          <td data-label="Password">{u.password}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
```

- [ ] **Step 5: Edit `AdminUsersPage.tsx` — "Skipped" results list**

Replace:
```tsx
                <ul>
                  {importResults.skipped
                    .slice((skippedPager.page - 1) * PAGE_SIZE, skippedPager.page * PAGE_SIZE)
                    .map((s) => (
                      <li key={s.email}>
                        {s.email}: {s.reason}
                      </li>
                    ))}
                </ul>
```
with:
```tsx
                <ul>
                  {importResults.skipped
                    .slice((skippedPager.page - 1) * PAGE_SIZE, skippedPager.page * PAGE_SIZE)
                    .map((s, i) => (
                      <li key={`${s.firstName ?? ''}-${s.lastName ?? ''}-${i}`}>
                        {s.firstName} {s.lastName}: {s.reason}
                      </li>
                    ))}
                </ul>
```

- [ ] **Step 6: Edit `AdminUsersPage.tsx` — main users table**

Replace:
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
```
with:
```tsx
        <table className="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
```

Replace:
```tsx
                  <tr>
                    <td data-label="Email">{u.email}</td>
                    <td data-label="First Name">{u.firstName ?? '—'}</td>
```
with:
```tsx
                  <tr>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="First Name">{u.firstName ?? '—'}</td>
```

- [ ] **Step 7: Edit `AdminUsersPage.tsx` — attempts modal label**

Replace:
```tsx
          userLabel={users.find((u) => u.id === modalUserId)?.email ?? ''}
```
with:
```tsx
          userLabel={users.find((u) => u.id === modalUserId)?.username ?? ''}
```

- [ ] **Step 8: Replace the full contents of `AdminUsersPage.test.tsx`**

```tsx
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
  useAuth.mockReturnValue({ user: { id: 'me', username: 'admin', role: 'admin' } });
  listUsers.mockResolvedValue({
    items: [
      {
        id: 'me',
        username: 'admin',
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
  toastSuccess.mockReset();
});

describe('AdminUsersPage', () => {
  test('lists every user with their role', async () => {
    render(<AdminUsersPage />);
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('student')).toBeInTheDocument();
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
    await screen.findByText('admin');
    const ownRow = screen.getByText('admin').closest('tr')!;
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
                  username: 'admin',
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
    await screen.findByText('admin');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(2));
    expect(await screen.findByText('student')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  function manyImportRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      row: i + 2,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      role: 'user' as const,
    }));
  }

  test('paginates the import preview table when there are more than one page of rows', async () => {
    parseUserImport.mockResolvedValue({ rows: manyImportRows(25), errors: [] });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('First0')).toBeInTheDocument();
    expect(screen.queryByText('First20')).not.toBeInTheDocument();

    const previewSection = screen.getByText('First0').closest('.import-preview') as HTMLElement;
    fireEvent.click(within(previewSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('First20')).toBeInTheDocument();
    expect(screen.queryByText('First0')).not.toBeInTheDocument();
  });

  function manyConfirmedUsers(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      username: `created${i}`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      role: 'user' as const,
      password: `pw${i}`,
    }));
  }

  function manySkippedUsers(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      firstName: `Skipped${i}`,
      lastName: 'User',
      reason: 'already registered',
    }));
  }

  test('paginates the import results "Created" table when there are more than one page', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({ created: manyConfirmedUsers(25), skipped: [] });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

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
    render(<AdminUsersPage />);
    await screen.findByText('admin');

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

  test('labels each cell in the import preview table for the mobile card layout', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    const row = (await screen.findByText('Jane')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual(['First Name', 'Last Name', 'Role']);
  });

  test('labels each cell in the import results "Created" table for the mobile card layout', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' }],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    const row = (await screen.findByText('abc123')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
      'Username',
      'First Name',
      'Last Name',
      'Role',
      'Password',
    ]);
  });

  function selectImportFile() {
    const file = new File(['First Name,Last Name\nJane,Doe'], 'students.csv', { type: 'text/csv' });
    const input = screen.getByLabelText(/user list file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  test('parsing a file shows a preview with row errors', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [{ row: 3, message: 'Row 3: last name is required' }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText(/row 3: last name is required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeEnabled();
  });

  test('confirming an import shows generated passwords and reloads the user list', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' }],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(confirmUserImport).toHaveBeenCalled());
    expect(await screen.findByText('abc123')).toBeInTheDocument();
    // listUsers is called once on mount, once more after a successful import.
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith('1 user created');
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
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' }],
      skipped: [{ firstName: 'John', lastName: 'Roe', reason: 'already registered' }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 user created, 1 skipped'));
  });

  test('copying created users writes a username,name,role,password CSV to the clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [{ username: 'jdoe', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' }],
      skipped: [],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));
    await screen.findByText('abc123');

    fireEvent.click(screen.getByRole('button', { name: /copy all as csv/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain('jdoe');
    expect(written).toContain('abc123');
  });

  test('Confirm import is disabled when there are no valid rows', async () => {
    parseUserImport.mockResolvedValue({ rows: [], errors: [{ row: 1, message: 'bad row' }] });
    render(<AdminUsersPage />);
    await screen.findByText('admin');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    await screen.findByText(/bad row/i);
    expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
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
```

- [ ] **Step 9: Run the affected test files**

Run: `cd frontend && npx vitest run src/admin/api.test.ts src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS, all tests across both files.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/admin/api.ts frontend/src/admin/api.test.ts frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat: switch admin users page and import flow to username"
```

---

### Task 17: Full-suite verification and manual smoke test

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS, every test file green. (Requires `backend/.env.test` to point at a `*_test` database that has already received the Task 1 `db:push:test`.)

- [ ] **Step 2: Typecheck the backend**

Run: `cd backend && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, every test file green.

- [ ] **Step 4: Typecheck the frontend**

Check `frontend/package.json` for the exact script name (likely `typecheck` or `tsc`), then run it from `frontend/`.
Expected: PASS, no errors.

- [ ] **Step 5: Manual smoke test — register, login, admin import, seed-admin**

Start both dev servers (check root/`backend`/`frontend` `package.json` for the exact dev scripts, e.g. `npm run dev` in each), then in the browser:
1. Go to the login page, switch to "Create an account", fill First name / Last name / Password, submit. Confirm you land signed-in and the account menu shows a generated username (first-initial + last name).
2. Sign out, then sign back in using that exact username + password. Confirm it succeeds.
3. As an admin (promote your test user via direct DB update if no admin exists yet, or run `seed-admin.ts` per Task 12), open Admin → Users, upload a CSV with `First Name,Last Name,Role` columns (no Email), confirm the import, and verify the "Created" table shows generated usernames and passwords.
4. Re-upload the same CSV and confirm the previously-imported rows show up under "Skipped" this time (name-based dedup).

Expected: all four steps behave as described, with no console errors in the browser or server logs.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

If Steps 1–5 required any follow-up fixes, commit them now with an appropriate message. If everything passed cleanly, there is nothing to commit for this task.

---

## Self-Review Notes

- **Spec coverage:** §1 schema → Task 1. §2 username generation → Task 2. §3 backend auth/model → Tasks 3–6. §4 admin import → Tasks 10–11. §5 seed-admin → Task 12. §6 frontend → Tasks 13, 15, 16. §7 tests → Tasks 5, 7, 8, 9, 10, 11, 14, 15, 16. All covered.
- **Placeholder scan:** no TBDs; every step with a code change shows the exact before/after code or a literal `sed` pattern.
- **Type consistency:** `createUser(firstName, lastName, passwordHash, role?)`, `findUserByName`, `findUserByUsernameWithHash`, and `PublicUser.username` are introduced once in Task 3 and used with the same names/signatures in every later task that touches them (Tasks 6, 11, 12). `registerTestUser(baseUrl, label)` returning `{ cookie, userId, username }` from Task 7 is used consistently in Tasks 8, 9, 11.

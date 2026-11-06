# Admin: manually add a single user — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create a single user from a small form on the Admin Users page, and change the password model so every admin-created user (single-add and bulk-import) gets the fixed initial password `liahwellness` and must change it on first login.

**Architecture:** Reuse the existing `createUser`/`findUserByName` model functions for the new single-add endpoint — same dedup check and username-collision suffixing bulk import already uses. A new `mustChangePassword` column on `users`, set `true` by both admin-creation paths and cleared by the existing `changePassword` endpoint, drives a new frontend route guard that blocks all app routes behind a forced "set your password" form until cleared.

**Tech Stack:** Express + Zod + Drizzle (Postgres) on the backend; React + react-router + Vitest/Testing Library on the frontend; `node --test` for backend tests.

## Global Constraints

- Initial/shared password for all admin-created users: the literal string `liahwellness` (not configurable, not random).
- A user with `mustChangePassword: true` must be blocked from every app route (including `/admin/users`) until they successfully change their password.
- Duplicate name on single-add: reject with `400 { error: 'A user with this name already exists' }` — do not create.
- No new migration files — schema changes go through `db:push` (dev) / `db:push:test` (test), per existing project convention (no committed `./drizzle` directory).
- Single-add request body: `{ firstName, lastName, role }`, same validation shape as the import row schema (`trim().min(1)`, `max(100)`, `role: z.enum(['user', 'admin'])`).

---

### Task 1: Add `mustChangePassword` column and thread it through the model layer

**Files:**
- Modify: `backend/src/models/schema.ts`
- Modify: `backend/src/models/user.model.ts`
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `PublicUser` now includes `mustChangePassword: boolean`. `createUser(firstName: string, lastName: string, passwordHash: string, role: 'user' | 'admin', mustChangePassword: boolean): Promise<PublicUser>` — note the signature grows a required 5th parameter (no default), so every existing call site must be updated in this task.
- Produces: `export const INITIAL_PASSWORD = 'liahwellness'` from `user.model.ts`.
- Produces: `clearMustChangePassword(id: string): Promise<void>` in `user.model.ts`.

- [ ] **Step 1: Add the column to the schema**

In `backend/src/models/schema.ts`, inside the `users` table definition (after the `role` column, before `createdAt`):

```ts
  /** Set true when an admin creates the account with the shared initial
   *  password; cleared the first time the user successfully changes it. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
```

- [ ] **Step 2: Push the schema to the test database**

Run: `cd backend && npm run db:push:test`
Expected: drizzle-kit reports the new column added, no destructive-change prompts (it's a new nullable-with-default column).

- [ ] **Step 3: Write the failing tests**

In `backend/src/models/user.model.test.ts`, add near the top of the import list:

```ts
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  updateName,
  clearMustChangePassword,
  INITIAL_PASSWORD,
} from './user.model.ts';
```

Add these tests (existing `createUser(...)` calls elsewhere in this file take 3-4 args today — leave those as-is for now; Step 5 updates them):

```ts
test('createUser persists mustChangePassword', async () => {
  const forced = await createUser('Must', 'Change', 'hash', 'user', true);
  assert.equal(forced.mustChangePassword, true);

  const free = await createUser('No', 'Force', 'hash', 'user', false);
  assert.equal(free.mustChangePassword, false);
});

test('clearMustChangePassword flips the flag to false', async () => {
  const user = await createUser('Clear', 'Flag', 'hash', 'user', true);
  await clearMustChangePassword(user.id);
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.mustChangePassword, false);
});

test('INITIAL_PASSWORD is the fixed shared password', () => {
  assert.equal(INITIAL_PASSWORD, 'liahwellness');
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && npm test -- --test-name-pattern "mustChangePassword|INITIAL_PASSWORD"`
Expected: FAIL — `clearMustChangePassword` and `INITIAL_PASSWORD` are not exported; `createUser` called with a 5th arg doesn't match current signature yet (TS error on `npm test` since it runs via `tsx`).

- [ ] **Step 5: Implement the model changes**

In `backend/src/models/user.model.ts`:

Add near the top, after the `publicColumns` constant:

```ts
/** Fixed initial password for every admin-created account (single-add and
 *  bulk import). A shared secret is a weaker guarantee than a random
 *  per-user password, which is why every admin-created account also gets
 *  mustChangePassword: true — the exposure window is bounded to "before
 *  the user's first login." */
export const INITIAL_PASSWORD = 'liahwellness';
```

Update `publicColumns` to include the new column:

```ts
const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};
```

Update the `PublicUser` type comment is unaffected (it's a `Pick<User, ...>` — add `'mustChangePassword'` to the picked keys):

```ts
export type PublicUser = Pick<
  User,
  'id' | 'username' | 'firstName' | 'lastName' | 'role' | 'mustChangePassword' | 'createdAt'
>;
```

Update `createUser`'s signature and insert call:

```ts
export async function createUser(
  firstName: string,
  lastName: string,
  passwordHash: string,
  role: 'user' | 'admin',
  mustChangePassword: boolean,
): Promise<PublicUser> {
  const base = buildBaseUsername(firstName, lastName);

  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt++) {
    const username = attempt === 1 ? base : `${base}${attempt}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash, firstName, lastName, role, mustChangePassword })
      .onConflictDoNothing({ target: users.username })
      .returning(publicColumns);

    if (user) return user;
  }

  throw new Error(`Could not generate a unique username for base "${base}" after ${MAX_USERNAME_ATTEMPTS} attempts`);
}
```

Add a new function after `updatePasswordHash`:

```ts
export async function clearMustChangePassword(id: string): Promise<void> {
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, id));
}
```

- [ ] **Step 6: Fix every other `createUser` call site's arity in this file's existing tests**

In `backend/src/models/user.model.test.ts`, every existing `createUser(a, b, 'hash')` or `createUser(a, b, 'hash', 'admin')` call now needs a `role` and `mustChangePassword` argument. Update each:

```ts
test('createUser defaults role to "user"', async () => {
  const user = await createUser('Role', 'Default', 'hash', 'user', false);
  assert.equal(user.role, 'user');
});
```
(Note: the "defaults role" test name is now slightly inaccurate since role is no longer optional — rename it to `'createUser stores the given role'`.)

Apply the same `, 'user', false` (or `, 'admin', false` where the test already passed `'admin'`) to every other `createUser(...)` call in the file: `'generates a username...'`, `'appends a number...'`, `'findUserByUsernameWithHash returns the hash...'` (x1), `'findUserByIdWithHash returns the hash...'` (x1), `'findUserByName matches...'`, `'updatePasswordHash persists...'`, `'createUser stores first/last name and role'` (already passes `'admin'` — add `, false`), and all four `updateName` tests' setup calls.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npm test -- --test-name-pattern "createUser|clearMustChangePassword|INITIAL_PASSWORD|findUserBy|updateName|updatePasswordHash"`
Expected: PASS, all green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/schema.ts backend/src/models/user.model.ts backend/src/models/user.model.test.ts
git commit -m "feat(api): add mustChangePassword flag and shared initial password constant"
```

---

### Task 2: Wire `mustChangePassword` through registration and password-change

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts`
- Test: `backend/src/controllers/auth.controller.test.ts`

**Interfaces:**
- Consumes: `createUser(firstName, lastName, passwordHash, role, mustChangePassword)` and `clearMustChangePassword(id)` from Task 1.
- Produces: `register`'s response `user.mustChangePassword` is always `false`. After a successful `PATCH /auth/password`, the user's `mustChangePassword` is `false` regardless of its prior value.

- [ ] **Step 1: Write the failing test**

In `backend/src/controllers/auth.controller.test.ts`, add:

```ts
test('POST /api/v1/auth/register never sets mustChangePassword', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Fresh', lastName: 'Signup', password: 'test-password-123' }),
  });
  const body = (await res.json()) as { user: { mustChangePassword: boolean } };
  assert.equal(body.user.mustChangePassword, false);
});

test('PATCH /api/v1/auth/password clears mustChangePassword', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'ForcedChange');
  // Force the flag on directly via the model, simulating an admin-created account.
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
  const { user } = (await meRes.json()) as { user: { id: string } };
  const { pool } = await import('../db/index.ts');
  await pool.query('update users set must_change_password = true where id = $1', [user.id]);

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-456' }),
  });
  assert.equal(res.status, 204);

  const newCookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const afterMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: newCookie } });
  const after = (await afterMe.json()) as { user: { mustChangePassword: boolean } };
  assert.equal(after.user.mustChangePassword, false);
});
```

(The direct SQL update is deliberate — nothing in the current auth surface lets a test set `mustChangePassword: true` on an existing user, and this test only needs to prove `changePassword` clears it, not how it got set.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- --test-name-pattern "mustChangePassword"`
Expected: FAIL on the register test (`createUser` call inside `register` is missing the new required argument — a TypeScript error) and the password test (nothing clears the flag yet).

- [ ] **Step 3: Implement**

In `backend/src/controllers/auth.controller.ts`:

Update the `register` handler's `createUser` call:

```ts
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, 'user', false);
```

Update the import line to include `clearMustChangePassword`:

```ts
import {
  createUser,
  findUserByUsernameWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  updateName,
  clearMustChangePassword,
} from '../models/user.model.ts';
```

In `changePassword`, after `updatePasswordHash`:

```ts
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await updatePasswordHash(existing.id, passwordHash);
  await clearMustChangePassword(existing.id);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- --test-name-pattern "mustChangePassword|register|password"`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite to catch any other now-broken `createUser` call sites**

Run: `cd backend && npm test`
Expected: Failures only in `admin-user-import.controller.test.ts` and `admin-users.controller.test.ts` if they construct users via a path touched later in this plan — if those fail now, note them but don't fix yet (Tasks 3–4 own those files). If `seed-admin.ts` or any script calls `createUser` directly, it will fail to typecheck; grep for it:

Run: `grep -rn "createUser(" backend/src --include=*.ts | grep -v test | grep -v node_modules`
Expected output includes `backend/src/scripts/seed-admin.ts` (or similar) and `auth.controller.ts` (just edited) and `user.model.ts` (definition) and `admin-user-import.controller.ts` (owned by Task 3). If a seed script call site shows up, fix it now:

```ts
const user = await createUser(firstName, lastName, passwordHash, 'admin', false);
```

(A seed-created admin sets their own password via env var, so no forced change.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/controllers/auth.controller.test.ts
git commit -m "feat(api): clear mustChangePassword on password change, never set it at self-signup"
```

---

### Task 3: Switch bulk import to the shared initial password

**Files:**
- Modify: `backend/src/controllers/admin-user-import.controller.ts`
- Test: `backend/src/controllers/admin-user-import.controller.test.ts`

**Interfaces:**
- Consumes: `createUser(firstName, lastName, passwordHash, role, mustChangePassword)`, `INITIAL_PASSWORD` from Task 1.
- Produces: `confirmImport`'s JSON response `created` items are now `{ username, firstName, lastName, role }` — no `password` field.

- [ ] **Step 1: Write the failing test**

Replace the existing `'POST /api/v1/admin/users/import/confirm creates users with a hashed password'` test in `backend/src/controllers/admin-user-import.controller.test.ts` with:

```ts
test('POST /api/v1/admin/users/import/confirm creates users with the shared initial password', async () => {
  const cookie = await adminCookie();
  const rows = [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'admin' as const }];

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{ username: string; firstName: string | null; lastName: string | null; role: string }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.username, 'jdoe');
  assert.equal(body.created[0]?.firstName, 'Jane');
  assert.equal(body.created[0]?.lastName, 'Doe');
  assert.equal(body.created[0]?.role, 'admin');
  assert.deepEqual(body.skipped, []);
  assert.equal('password' in (body.created[0] ?? {}), false);

  const stored = await findUserByUsernameWithHash('jdoe');
  assert.equal(stored?.mustChangePassword, true);

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'jdoe', password: 'liahwellness' }),
  });
  assert.equal(login.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- --test-name-pattern "shared initial password"`
Expected: FAIL — `createUser` call in `confirmImport` doesn't match the new 5-arg signature (TS error), and the response still includes `password`.

- [ ] **Step 3: Implement**

In `backend/src/controllers/admin-user-import.controller.ts`:

```ts
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseUserRows } from '../lib/user-import-parser.ts';
import { createUser, findUserByName, INITIAL_PASSWORD } from '../models/user.model.ts';
```

(Drop the `randomBytes` import — `generatePassword` is deleted below.)

Delete the `generatePassword` function entirely.

Replace the body of `confirmImport`:

```ts
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
  }> = [];
  const skipped: Array<{ firstName: string | null; lastName: string | null; reason: string }> = [];

  const passwordHash = await argon2.hash(INITIAL_PASSWORD, { type: argon2.argon2id });

  for (const row of parsed.data.rows) {
    const existing = await findUserByName(row.firstName, row.lastName);
    if (existing) {
      skipped.push({ firstName: row.firstName, lastName: row.lastName, reason: 'already registered' });
      continue;
    }

    const user = await createUser(row.firstName, row.lastName, passwordHash, row.role, true);

    created.push({
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    });
  }

  res.json({ created, skipped });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- --test-name-pattern "import"`
Expected: PASS — this also covers the 150-row and 200-row round-trip tests, which don't assert on `password` and are unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin-user-import.controller.ts backend/src/controllers/admin-user-import.controller.test.ts
git commit -m "feat(api): bulk-imported users get the shared initial password and must change it"
```

---

### Task 4: Single-add endpoint

**Files:**
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `createUser`, `findUserByName`, `INITIAL_PASSWORD` from `user.model.ts`.
- Produces: `POST /api/v1/admin/users` — body `{ firstName, lastName, role }`, `201 { user: PublicUser }` on success, `400 { error }` on validation failure or duplicate name. Already covered by the existing `requireAuth, requireAdmin` middleware on the `/admin` router, so non-admins get `404` for free (same as every other route in this file).

- [ ] **Step 1: Write the failing tests**

In `backend/src/controllers/admin-users.controller.test.ts`, add:

```ts
test('POST /api/v1/admin/users creates a user with the shared initial password', async () => {
  const { cookie } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Person', role: 'user' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    user: { username: string; firstName: string; lastName: string; role: string; mustChangePassword: boolean };
  };
  assert.equal(body.user.username, 'nperson');
  assert.equal(body.user.firstName, 'New');
  assert.equal(body.user.lastName, 'Person');
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.mustChangePassword, true);
  assert.equal('password' in body.user, false);

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nperson', password: 'liahwellness' }),
  });
  assert.equal(login.status, 200);
});

test('POST /api/v1/admin/users rejects a duplicate name', async () => {
  const { cookie } = await makeAdmin('Admin');
  await registerTestUser(baseUrl, 'Existing');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'Existing', role: 'user' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'A user with this name already exists');
});

test('POST /api/v1/admin/users rejects a missing last name', async () => {
  const { cookie } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Solo', lastName: '', role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/v1/admin/users 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Person', role: 'user' }),
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- --test-name-pattern "POST /api/v1/admin/users creates|duplicate name|missing last name|404s for a non-admin"`
Expected: FAIL with 404 (route doesn't exist yet) on the first three.

- [ ] **Step 3: Implement**

In `backend/src/controllers/admin-users.controller.ts`, update imports and add the handler:

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { PAGE_SIZE, parsePage } from '../lib/pagination.ts';
import { listAttemptsForUser } from '../models/admin-attempt.model.ts';
import {
  countUsers,
  deleteUserById,
  findUserById,
  listUsers,
  setUserRole,
} from '../models/admin-user.model.ts';
import { createUser, findUserByName, INITIAL_PASSWORD } from '../models/user.model.ts';
import argon2 from 'argon2';

const roleBody = z.object({ role: z.enum(['user', 'admin']) });

const createUserBody = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  role: z.enum(['user', 'admin']),
});

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { firstName, lastName, role } = parsed.data;

  const existing = await findUserByName(firstName, lastName);
  if (existing) {
    res.status(400).json({ error: 'A user with this name already exists' });
    return;
  }

  const passwordHash = await argon2.hash(INITIAL_PASSWORD, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, role, true);
  res.status(201).json({ user });
}
```

(Place the new handler and `createUserBody` schema right after the existing `roleBody` declaration, before `getUsers`, to match the file's top-to-bottom "schemas, then handlers in route order" convention.)

In `backend/src/routes/admin.routes.ts`, add the route:

```ts
adminRouter.get('/users', adminUsers.getUsers);
adminRouter.post('/users', adminUsers.createUserHandler);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- --test-name-pattern "admin/users"`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(api): add POST /admin/users to create a single user"
```

---

### Task 5: Frontend `User` type and auth context gain `mustChangePassword`

**Files:**
- Modify: `frontend/src/auth/api.ts`

**Interfaces:**
- Produces: `User` type includes `mustChangePassword: boolean`. No behavior change yet — this just makes the field available to the router guard built in Task 6.

- [ ] **Step 1: Update the type**

In `frontend/src/auth/api.ts`:

```ts
export type User = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  mustChangePassword: boolean;
  createdAt: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: Fails wherever a test constructs a `User`-shaped object without `mustChangePassword` (none should, since those are plain mocked objects typed loosely in tests — but confirm):

Run: `cd frontend && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -i "mustChangePassword\|User"`
Expected: no output (test files mock `useAuth` with inline objects not type-checked against `User`, since `vi.fn()` erases the type). If any production (non-test) file breaks, fix it now by adding `mustChangePassword` to the relevant object literal.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/auth/api.ts
git commit -m "feat(web): add mustChangePassword to the User type"
```

---

### Task 6: Forced password-change gate

**Files:**
- Create: `frontend/src/auth/ForcedPasswordChangeForm.tsx`
- Create: `frontend/src/auth/ForcedPasswordChangeForm.test.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/router.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `{ user, updateUser }`; `authApi.changePassword(currentPassword, newPassword): Promise<void>` (existing, from `auth/api.ts`); `MIN_PASSWORD_LENGTH` (existing, from `auth/api.ts`).
- Produces: `RequireFreshPassword` component in `router.tsx`, exported for the test file to exercise via `AppRouter`. Renders `ForcedPasswordChangeForm` instead of `children` when `user.mustChangePassword` is true.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/auth/ForcedPasswordChangeForm.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ForcedPasswordChangeForm } from './ForcedPasswordChangeForm';

const changePassword = vi.fn();
const updateUser = vi.fn();
const useAuth = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, authApi: { changePassword: (a: string, b: string) => changePassword(a, b) } };
});
vi.mock('./useAuth', () => ({ useAuth: () => useAuth() }));

beforeEach(() => {
  changePassword.mockReset();
  updateUser.mockReset();
  useAuth.mockReturnValue({
    user: { id: 'u1', username: 'new.user', mustChangePassword: true },
    updateUser,
  });
});

describe('ForcedPasswordChangeForm', () => {
  test('submits the temporary password as current and the new password', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'liahwellness' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('liahwellness', 'my-new-password-1'));
  });

  test('clears mustChangePassword on the user after a successful change', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'liahwellness' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', mustChangePassword: false }),
      ),
    );
  });

  test('shows an error and does not clear the flag when the API call fails', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ForcedPasswordChangeForm />);

    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'my-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/auth/ForcedPasswordChangeForm.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/auth/ForcedPasswordChangeForm.tsx`:

```tsx
import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

export function ForcedPasswordChangeForm() {
  const { user, updateUser } = useAuth();
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.changePassword(temporaryPassword, newPassword);
      if (user) updateUser({ ...user, mustChangePassword: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Set your password</h1>
      <p>An admin created your account with a temporary password. Set your own password to continue.</p>

      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
        <div className="auth-fields">
          <input
            type="password"
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            placeholder="Temporary password"
            aria-label="Temporary password"
            autoComplete="current-password"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </div>

        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}

        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Working…' : 'Set password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/auth/ForcedPasswordChangeForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing router test**

In `frontend/src/router.test.tsx`, add inside the `describe('AppRouter', ...)` block:

```tsx
  test('a user with mustChangePassword sees the forced password form, not the requested page', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', username: 'new.user', role: 'user', mustChangePassword: true, createdAt: '2026-11-06T00:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    });

    at('/subjects');

    expect(screen.getByText('Set your password')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });

  test('a user with mustChangePassword hitting /admin/users still sees the forced form, not the users table', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', username: 'admin.new', role: 'admin', mustChangePassword: true, createdAt: '2026-11-06T00:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    });

    at('/admin/users');

    expect(screen.getByText('Set your password')).toBeInTheDocument();
  });
```

Also update the `vi.mock('./auth/useAuth', ...)` setup's default `beforeEach` return value (and every other `mockReturnValue` in this file) to include `mustChangePassword: false` and `updateUser: vi.fn()`, so the existing passing tests stay passing once the guard is wired in (it reads `user.mustChangePassword`, which is currently `undefined` → falsy → fine, but add it explicitly for clarity and to match the real `User` shape):

```ts
beforeEach(() => {
  useAuth.mockReturnValue({
    user: { id: 'u1', username: 'absmith', role: 'user', mustChangePassword: false, createdAt: '2026-11-02T12:00:00.000Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
  });
});
```

Add `mustChangePassword: false, updateUser: vi.fn(),` to the two other inline `mockReturnValue` calls in the existing tests (`user: null` ones don't need it since `RequireFreshPassword` only renders once a user exists, but the non-admin-404 test's `mockReturnValue` does).

- [ ] **Step 6: Run router tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/router.test.tsx`
Expected: FAIL on the two new tests — `RequireFreshPassword` doesn't exist yet, so `/subjects` renders the real subjects page instead of "Set your password".

- [ ] **Step 7: Implement the router guard**

In `frontend/src/router.tsx`:

```tsx
import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ForcedPasswordChangeForm } from './auth/ForcedPasswordChangeForm';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';
import { AdminImportPage } from './pages/admin/AdminImportPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProgressPage } from './pages/ProgressPage';
import { QuizPage } from './pages/QuizPage';
import { ResultsPage } from './pages/ResultsPage';
import { SubjectCoursesPage, SubjectsIndexPage } from './pages/SubjectCoursesPage';
import { AppShell } from './shell/AppShell';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user) return <LoginForm />;
  return <>{children}</>;
}

/**
 * Blocks every signed-in route — admin routes included — behind the forced
 * password-change form while mustChangePassword is true. Sits inside
 * RequireAuth, so it only ever runs once a user is known.
 */
function RequireFreshPassword({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.mustChangePassword) return <ForcedPasswordChangeForm />;
  return <>{children}</>;
}

/**
 * Renders the 404 page, not a 403, for a signed-in non-admin — a non-admin
 * should not be able to tell an admin route exists. Signed-out also 404s
 * rather than prompting sign-in, for the same reason.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user || user.role !== 'admin') return <NotFoundPage />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireFreshPassword>
                <Navigate to="/subjects" replace />
              </RequireFreshPassword>
            </RequireAuth>
          }
        />
        <Route path="/courses" element={<Navigate to="/subjects" replace />} />

        <Route
          element={
            <RequireAuth>
              <RequireFreshPassword>
                <AppShell />
              </RequireFreshPassword>
            </RequireAuth>
          }
        >
          <Route path="/subjects" element={<SubjectsIndexPage />} />
          <Route path="/subjects/:subjectSlug" element={<SubjectCoursesPage />} />
          <Route path="/courses/:slug/quiz" element={<QuizPage />} />
          <Route path="/courses/:slug/results/:attemptId" element={<ResultsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/import"
            element={
              <RequireAdmin>
                <AdminImportPage />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/router.test.tsx src/router.admin-guard.test.tsx`
Expected: PASS. If `router.admin-guard.test.tsx` fails because its `mockReturnValue` objects also lack `mustChangePassword`, add `mustChangePassword: false` to those too (the guard treats `undefined` as falsy already, so this is a hygiene fix, not a required one — confirm by running first before editing).

- [ ] **Step 9: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions (the `/` and `/admin/users` route structure is unchanged for a user with `mustChangePassword: false`, which is every existing test's implicit or explicit state).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/auth/ForcedPasswordChangeForm.tsx frontend/src/auth/ForcedPasswordChangeForm.test.tsx frontend/src/router.tsx frontend/src/router.test.tsx frontend/src/router.admin-guard.test.tsx
git commit -m "feat(web): block the app behind a forced password change when required"
```

---

### Task 7: Admin API client — drop per-user password, add single-create

**Files:**
- Modify: `frontend/src/admin/api.ts`

**Interfaces:**
- Produces: `ConfirmedUser` drops `password`. New `adminApi.createUser(firstName: string, lastName: string, role: 'user' | 'admin'): Promise<{ user: AdminUser }>`.

- [ ] **Step 1: Update types and add the client method**

In `frontend/src/admin/api.ts`:

```ts
export type ConfirmedUser = {
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
};
```

Add to the `adminApi` object (near `listUsers`):

```ts
  createUser: (firstName: string, lastName: string, role: 'user' | 'admin') =>
    request<{ user: AdminUser }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, role }),
    }),
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -i "ConfirmedUser\|password"`
Expected: Errors pointing into `AdminUsersPage.tsx` (still reads `u.password` — fixed in Task 9) and its test file. Confirm the errors are confined to those two files; no other production file reads `ConfirmedUser.password`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/admin/api.ts
git commit -m "feat(web): admin API client drops per-user password, adds single-user create"
```

(This task intentionally leaves `AdminUsersPage.tsx` red — Task 9 fixes it immediately after. Keeping the type change isolated makes the diff that breaks `ConfirmedUser.password` easy to review on its own.)

---

### Task 8: Admin Users page — single-add form, drop per-user password from import results

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `adminApi.createUser` (Task 7), `ConfirmedUser` without `password` (Task 7).
- Produces: a new "Add a user" form section above "Seed users from a file"; the import-results "Created" table drops its Password column and gains a one-line note.

- [ ] **Step 1: Extend the CSS so a `<select>` matches the existing joined-field input styling**

In `frontend/src/App.css`, the add-user form puts a `<select>` as the last element in an `.auth-fields` group — update the three input-only selectors to also match `select`, and add a `.admin-add-user-form` wrapper width matching `.import-form`:

```css
.auth-form input,
.auth-form select {
  padding: 0.6rem 0.75rem;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: inherit;
}
```

```css
.auth-fields input:first-child,
.auth-fields select:first-child {
  border-radius: 0.5rem 0.5rem 0 0;
}
.auth-fields input:last-child,
.auth-fields select:last-child {
  margin-top: -1px;
  border-radius: 0 0 0.5rem 0.5rem;
}
```

```css
.auth-form input:focus-visible,
.auth-form select:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-color: var(--accent);
}
```

Add near `.import-form`:

```css
.admin-add-user-form { max-width: 24rem; margin-top: 1rem; }
```

- [ ] **Step 2: Write the failing component tests**

In `frontend/src/pages/admin/AdminUsersPage.test.tsx`:

Update the `vi.mock('../../admin/api', ...)` block to add `createUser`:

```ts
const createUser = vi.fn();
// ...
vi.mock('../../admin/api', () => ({
  adminApi: {
    listUsers: (page: number) => listUsers(page),
    setRole: (id: string, role: string) => setRole(id, role),
    deleteUser: (id: string) => deleteUser(id),
    getUserAttempts: (id: string) => getUserAttempts(id),
    parseUserImport: (file: File) => parseUserImport(file),
    confirmUserImport: (rows: unknown) => confirmUserImport(rows),
    createUser: (firstName: string, lastName: string, role: string) => createUser(firstName, lastName, role),
  },
}));
```

Add `createUser.mockReset();` to the `beforeEach`.

Add new tests:

```tsx
  test('adding a user calls createUser and refreshes the list', async () => {
    createUser.mockResolvedValue({
      user: { id: 'u3', username: 'njordan', firstName: 'New', lastName: 'Jordan', role: 'user', createdAt: '2026-11-06T00:00:00Z' },
    });
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Jordan' } });
    fireEvent.click(screen.getByRole('button', { name: /add user/i }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith('New', 'Jordan', 'user'));
    expect(toastSuccess).toHaveBeenCalledWith('User created. Initial password: liahwellness');
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
  });

  test('a duplicate-name error from createUser shows inline and keeps the form filled', async () => {
    createUser.mockRejectedValue(new Error('A user with this name already exists'));
    render(<AdminUsersPage />);
    await screen.findByText('adminuser');

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Existing' } });
    fireEvent.click(screen.getByRole('button', { name: /add user/i }));

    expect(await screen.findByText('A user with this name already exists')).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Test');
  });
```

Update the existing import-results tests that reference `password`:
- `manyConfirmedUsers` helper: drop `password: `pw${i}`` from the returned objects.
- The two `confirmUserImport.mockResolvedValue` calls that include `password: 'abc123'` in their `created` rows: drop that field.
- `'labels each cell in the import results "Created" table for the mobile card layout'`: change the expected `data-label` array to drop `'Password'`, and find the row by a field that still exists (e.g. `screen.findByText('jdoe')` instead of `screen.findByText('abc123')`).
- `'confirming an import shows generated passwords and reloads the user list'`: rename to `'confirming an import shows a success toast and reloads the user list'`; replace `expect(await screen.findByText('abc123')).toBeInTheDocument();` with `expect(await screen.findByText('jdoe')).toBeInTheDocument();` and add `expect(screen.getByText(/initial password for all created users: liahwellness/i)).toBeInTheDocument();`.
- `'copying created users writes a username,name,role,password CSV to the clipboard'`: rename to `'copying created users writes a username,name,role CSV to the clipboard'`; the clipboard assertion drops the `abc123` check (`expect(written).toContain('jdoe')` stays; remove `expect(written).toContain('abc123')`).

- [ ] **Step 3: Run tests to verify the new/changed ones fail**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: FAIL — no "Add user" form exists yet; CSV/table still reference the old password field.

- [ ] **Step 4: Implement the page changes**

In `frontend/src/pages/admin/AdminUsersPage.tsx`:

Add imports/state near the top of the component (after the existing `importBusy`/`importError` state):

```tsx
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);
```

Add a handler function (near `confirmImport`):

```tsx
  const addUser = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddUserBusy(true);
    setAddUserError(null);
    try {
      await adminApi.createUser(newFirstName, newLastName, newRole);
      toast.success('User created. Initial password: liahwellness');
      setNewFirstName('');
      setNewLastName('');
      setNewRole('user');
      load(pager.page);
    } catch (err) {
      setAddUserError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAddUserBusy(false);
    }
  };
```

Add `SubmitEvent` to the existing React import at the top of the file: change `import { Fragment, useCallback, useEffect, useState } from 'react';` to `import { Fragment, useCallback, useEffect, useState, type SubmitEvent } from 'react';`.

Add the new section in the JSX, immediately before the `<section className="admin-import-users">` block:

```tsx
      <section className="admin-add-user">
        <h2>Add a user</h2>
        <form onSubmit={(e) => void addUser(e)} className="auth-form admin-add-user-form">
          <div className="auth-fields">
            <input
              type="text"
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              placeholder="First name"
              aria-label="First name"
            />
            <input
              type="text"
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              placeholder="Last name"
              aria-label="Last name"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
              aria-label="Role"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {addUserError && (
            <p role="alert" className="auth-error">
              {addUserError}
            </p>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={addUserBusy || !newFirstName.trim() || !newLastName.trim()}
            aria-busy={addUserBusy}
          >
            {addUserBusy ? 'Working…' : 'Add user'}
          </button>
        </form>
      </section>
```

Update the import-results "Created" block — remove the Password column and copy-CSV field, and add the note. Replace this whole sub-block:

```tsx
            {importResults.created.length > 0 && (
              <>
                <h3>Created</h3>
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
                <Pager
                  page={createdPager.page}
                  totalPages={createdPager.totalPages}
                  canPrev={createdPager.canPrev}
                  canNext={createdPager.canNext}
                  onPrev={createdPager.prev}
                  onNext={createdPager.next}
                />
              </>
            )}
```

with:

```tsx
            {importResults.created.length > 0 && (
              <>
                <h3>Created</h3>
                <p>Initial password for all created users: <code>liahwellness</code></p>
                <button
                  type="button"
                  onClick={() => {
                    const header = 'username,firstName,lastName,role';
                    const lines = importResults.created.map(
                      (u) => `${u.username},${u.firstName ?? ''},${u.lastName ?? ''},${u.role}`,
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
                        </tr>
                      ))}
                  </tbody>
                </table>
                <Pager
                  page={createdPager.page}
                  totalPages={createdPager.totalPages}
                  canPrev={createdPager.canPrev}
                  canNext={createdPager.canNext}
                  onPrev={createdPager.prev}
                  onNext={createdPager.next}
                />
              </>
            )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and run the full frontend suite**

Run: `cd frontend && npm run typecheck && npm test`
Expected: PASS, no remaining red from Task 7's intentional breakage.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx frontend/src/App.css
git commit -m "feat(web): add single-user-add form, drop per-user password from import UI"
```

---

### Task 9: End-to-end manual check

**Files:** none (verification only).

- [ ] **Step 1: Push schema and start both servers**

Run: `cd backend && npm run db:push` (dev database), then start the backend and frontend dev servers per the project's existing `run` workflow.

- [ ] **Step 2: Manually verify in the browser**

1. Sign in as an existing admin, go to `/admin/users`.
2. Use "Add a user" to create a user named "Casey Example" with role "user". Confirm the toast reads "User created. Initial password: liahwellness" and the table refreshes to show `cexample`.
3. Sign out, sign in as `cexample` / `liahwellness`. Confirm you land on "Set your password" instead of the subjects page.
4. Submit the form with the wrong temporary password — confirm an inline error, no navigation.
5. Submit with the correct temporary password and a new password ≥ 8 characters — confirm you land on the subjects page.
6. Sign out, sign back in as `cexample` with the new password — confirm normal access, no forced-change screen.
7. Repeat steps 2–3 using the bulk-import flow (upload a tiny CSV) — confirm the created-users table has no Password column, shows the `liahwellness` note, and the new user is also forced through the change-password screen on first login.

- [ ] **Step 3: Report back**

No commit for this task — it's verification only. If any manual check fails, return to the relevant task above and fix before considering the plan complete.

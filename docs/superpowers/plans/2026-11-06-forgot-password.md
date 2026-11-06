# Forgot password: admin reset + request notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin reset any user's (including another admin's) password back to the shared `INITIAL_PASSWORD` with a forced change on next login, and let a signed-out user flag their own account from the login page so an admin sees it in a request queue — all without adding email.

**Architecture:** A new `password_reset_requests` table (one row per user, upserted) backs a public "submit a request" endpoint and an admin "view/dismiss" endpoint. A separate admin "reset password" endpoint reuses the existing `INITIAL_PASSWORD` + `mustChangePassword` + session-kill mechanism already used for admin-created/imported users, and also clears any pending request for that user. A CLI script covers the no-other-admin-available case.

**Tech Stack:** Express + Drizzle ORM (Postgres) on the backend, React + Vite + Vitest on the frontend, `node:test` for backend tests.

## Global Constraints

- A password reset always sets the password to `INITIAL_PASSWORD` (`'liahwellness'`, in `backend/src/models/user.model.ts`) — never a randomly generated one.
- `POST /api/v1/auth/forgot-password` always responds `204`, regardless of whether the username exists or is active — it must never reveal account existence.
- At most one pending request per user — a repeat "forgot password" click updates the existing row's timestamp rather than creating a second one.
- Resetting a password must kill every existing session for that user (same as the self-service change-password flow) and must clear any pending request for that user.
- An admin cannot reset their own password through this mechanism (existing self-action guard pattern — use the normal change-password form instead).
- Every schema change to `backend/src/models/schema.ts` must be followed by `npm run db:generate -w backend` (commit the generated SQL under `backend/drizzle/`) and, before running backend tests, `cd backend && npm run db:push:test` to apply it to the local test DB.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/models/schema.ts` | Modify: add `password_reset_requests` table |
| `backend/drizzle/*.sql` | New migration (generated, not hand-written) |
| `backend/src/models/password-reset-request.model.ts` | New: upsert/list/delete pending requests |
| `backend/src/models/user.model.ts` | Modify: add `forcePasswordChange(id)` |
| `backend/src/controllers/auth.controller.ts` | Modify: add `forgotPassword` handler |
| `backend/src/routes/auth.routes.ts` | Modify: register `POST /forgot-password` |
| `backend/src/controllers/admin-users.controller.ts` | Modify: add `resetUserPassword`, `getPasswordResetRequests`, `dismissPasswordResetRequest` |
| `backend/src/routes/admin.routes.ts` | Modify: register the three new admin routes |
| `backend/src/scripts/reset-admin-password.ts` | New: break-glass CLI reset |
| `backend/package.json` | Modify: add `reset-admin-password` script |
| `frontend/src/admin/api.ts` | Modify: add `resetPassword`, `listPasswordRequests`, `dismissPasswordRequest`, `PasswordResetRequest` type |
| `frontend/src/auth/api.ts` | Modify: add `authApi.forgotPassword` |
| `frontend/src/shell/icons.tsx` | Modify: add `KeyIcon` |
| `frontend/src/pages/admin/AdminUsersPage.tsx` | Modify: add a "Reset password" row action |
| `frontend/src/pages/admin/PasswordRequestsPage.tsx` | New: list pending requests, reset/dismiss |
| `frontend/src/router.tsx` | Modify: register `/admin/password-reset-requests` |
| `frontend/src/shell/AccountMenu.tsx` | Modify: add "Admin · Password Requests" link |
| `frontend/src/auth/LoginForm.tsx` | Modify: add "Forgot password?" mode |

---

### Task 1: `password_reset_requests` schema + model

**Files:**
- Modify: `backend/src/models/schema.ts`
- Create: `backend/src/models/password-reset-request.model.ts`
- Test: `backend/src/models/password-reset-request.model.test.ts`

**Interfaces:**
- Produces: `upsertPasswordResetRequest(userId: string): Promise<void>`, `listPasswordResetRequests(): Promise<PendingPasswordResetRequest[]>`, `deletePasswordResetRequest(userId: string): Promise<void>`, where `PendingPasswordResetRequest = { userId: string; username: string; firstName: string | null; lastName: string | null; requestedAt: Date }`.

- [ ] **Step 1: Add the table to the schema**

In `backend/src/models/schema.ts`, add directly after the `sessions` table block (before `export type User = ...`):

```ts
/** One pending "forgot password" request per user. userId is unique so a
 *  repeat request updates requestedAt instead of creating a second row. */
export const passwordResetRequests = pgTable('password_reset_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
});
```

And add its inferred type next to the others:

```ts
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PasswordResetRequestRow = typeof passwordResetRequests.$inferSelect;
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate -w backend`
Expected: a new file appears under `backend/drizzle/`, e.g. `0002_<name>.sql`, containing `CREATE TABLE "password_reset_requests" (...)` with a unique constraint on `user_id`.

Run: `cd backend && npm run db:push:test`
Expected: exits 0, applies the new table to the local test database.

- [ ] **Step 3: Write the failing test**

Create `backend/src/models/password-reset-request.model.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser } from './user.model.ts';
import {
  upsertPasswordResetRequest,
  listPasswordResetRequests,
  deletePasswordResetRequest,
} from './password-reset-request.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('upsertPasswordResetRequest creates a pending request', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);

  const requests = await listPasswordResetRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.userId, user.id);
  assert.equal(requests[0]?.username, user.username);
});

test('a second request for the same user updates the timestamp instead of adding a row', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);
  const first = await listPasswordResetRequests();

  await upsertPasswordResetRequest(user.id);
  const second = await listPasswordResetRequests();

  assert.equal(second.length, 1);
  assert.ok(second[0]!.requestedAt.getTime() >= first[0]!.requestedAt.getTime());
});

test('listPasswordResetRequests orders newest first', async () => {
  const first = await createUser('First', 'User', 'hash', 'user', false);
  const second = await createUser('Second', 'User', 'hash', 'user', false);
  await upsertPasswordResetRequest(first.id);
  await upsertPasswordResetRequest(second.id);

  const requests = await listPasswordResetRequests();
  assert.deepEqual(requests.map((r) => r.userId), [second.id, first.id]);
});

test('deletePasswordResetRequest removes the pending row', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);
  await deletePasswordResetRequest(user.id);

  assert.deepEqual(await listPasswordResetRequests(), []);
});

test('deletePasswordResetRequest is a no-op when there is no pending request', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await deletePasswordResetRequest(user.id);
  assert.deepEqual(await listPasswordResetRequests(), []);
});
```

Run: `npm run test -w backend -- --test-name-pattern password-reset-request`
Expected: FAIL — `Cannot find module './password-reset-request.model.ts'`.

- [ ] **Step 4: Implement the model**

Create `backend/src/models/password-reset-request.model.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { passwordResetRequests, users } from './schema.ts';

export type PendingPasswordResetRequest = {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  requestedAt: Date;
};

/** Upserts a pending request for this user — a repeat request just bumps
 *  requestedAt rather than creating a second row (userId is unique). */
export async function upsertPasswordResetRequest(userId: string): Promise<void> {
  await db
    .insert(passwordResetRequests)
    .values({ userId })
    .onConflictDoUpdate({
      target: passwordResetRequests.userId,
      set: { requestedAt: new Date() },
    });
}

/** All pending requests, joined to the user, newest first. */
export async function listPasswordResetRequests(): Promise<PendingPasswordResetRequest[]> {
  return db
    .select({
      userId: passwordResetRequests.userId,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      requestedAt: passwordResetRequests.requestedAt,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(users.id, passwordResetRequests.userId))
    .orderBy(desc(passwordResetRequests.requestedAt));
}

/** No-op if there's no pending request for this user. */
export async function deletePasswordResetRequest(userId: string): Promise<void> {
  await db.delete(passwordResetRequests).where(eq(passwordResetRequests.userId, userId));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern password-reset-request`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/schema.ts backend/drizzle/ backend/src/models/password-reset-request.model.ts backend/src/models/password-reset-request.model.test.ts
git commit -m "feat(db): add password_reset_requests table and model"
```

---

### Task 2: `forcePasswordChange` on the user model

**Files:**
- Modify: `backend/src/models/user.model.ts`
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `forcePasswordChange(id: string): Promise<void>` — sets `mustChangePassword` to `true`. (Mirrors the existing `clearMustChangePassword`, which sets it to `false`.)

- [ ] **Step 1: Write the failing test**

Add to `backend/src/models/user.model.test.ts`, alongside the existing `clearMustChangePassword` import and test:

```ts
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  clearMustChangePassword,
  forcePasswordChange,
  INITIAL_PASSWORD,
} from './user.model.ts';
```

```ts
test('forcePasswordChange flips the flag to true', async () => {
  const user = await createUser('Force', 'Flag', 'hash', 'user', false);
  await forcePasswordChange(user.id);
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.mustChangePassword, true);
});
```

Run: `npm run test -w backend -- --test-name-pattern forcePasswordChange`
Expected: FAIL — `forcePasswordChange is not a function` (or import error).

- [ ] **Step 2: Implement it**

In `backend/src/models/user.model.ts`, directly after `clearMustChangePassword`:

```ts
export async function forcePasswordChange(id: string): Promise<void> {
  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, id));
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern forcePasswordChange`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/models/user.model.test.ts
git commit -m "feat(auth): add forcePasswordChange to the user model"
```

---

### Task 3: Admin reset-password endpoint

**Files:**
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `forcePasswordChange`, `INITIAL_PASSWORD` (Task 2 / existing), `deleteSessionsForUser` (existing, `session.model.ts`), `deletePasswordResetRequest` (Task 1), `findUserById` (existing, `admin-user.model.ts`).
- Produces: `POST /api/v1/admin/users/:id/reset-password` → `204`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/admin-users.controller.test.ts`:

```ts
test('POST .../reset-password resets to the shared initial password and forces a change', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const oldLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test-password-123' }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'liahwellness' }),
  });
  assert.equal(newLogin.status, 200);
  const body = (await newLogin.json()) as { user: { mustChangePassword: boolean } };
  assert.equal(body.user.mustChangePassword, true);
});

test('POST .../reset-password kills the user\'s existing session immediately', async () => {
  const { cookie: adminCookie } = await makeAdmin('Admin');
  const { cookie: studentCookie, userId } = await registerTestUser(baseUrl, 'Student');

  const before = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(before.status, 200);

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie: adminCookie },
  });

  const after = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(after.status, 401);
});

test('POST .../reset-password rejects an admin resetting themselves', async () => {
  const { cookie, userId } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});

test('POST .../reset-password 404s for an already-deleted user', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, { method: 'DELETE', headers: { cookie } });

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});

test('POST .../reset-password works on another admin', async () => {
  const { cookie: adminACookie } = await makeAdmin('AdminA');
  const { userId: adminBId, username: adminBUsername } = await makeAdmin('AdminB');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${adminBId}/reset-password`, {
    method: 'POST',
    headers: { cookie: adminACookie },
  });
  assert.equal(res.status, 204);

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminBUsername, password: 'liahwellness' }),
  });
  assert.equal(login.status, 200);
});

test('POST .../reset-password 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});
```

Run: `npm run test -w backend -- --test-name-pattern reset-password`
Expected: FAIL — the route doesn't exist yet, so every request 404s via the generic not-found handler, and the assertions on `204`/`400` fail.

- [ ] **Step 2: Implement the controller handler**

In `backend/src/controllers/admin-users.controller.ts`, update the top imports:

```ts
import {
  createUser,
  findUserByName,
  forcePasswordChange,
  INITIAL_PASSWORD,
  updatePasswordHash,
} from '../models/user.model.ts';
import { deleteSessionsForUser } from '../models/session.model.ts';
import { deletePasswordResetRequest } from '../models/password-reset-request.model.ts';
```

Add the handler, after `deleteUser`:

```ts
export async function resetUserPassword(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'Use the change-password form to update your own password' });
    return;
  }

  const target = await findUserById(id);
  if (!target || !target.isActive) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const passwordHash = await argon2.hash(INITIAL_PASSWORD, { type: argon2.argon2id });
  await updatePasswordHash(id, passwordHash);
  await forcePasswordChange(id);
  await deleteSessionsForUser(id);
  await deletePasswordResetRequest(id);

  res.status(204).end();
}
```

`findUserById`, `argon2`, and `param` are already imported in this file.

- [ ] **Step 3: Register the route**

In `backend/src/routes/admin.routes.ts`, add directly after the existing `restore` route:

```ts
adminRouter.post('/users/:id/restore', adminUsers.restoreUserHandler);
adminRouter.post('/users/:id/reset-password', adminUsers.resetUserPassword);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern reset-password`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(admin): add reset-password endpoint for users and admins"
```

---

### Task 4: Public forgot-password endpoint

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Test: `backend/src/controllers/auth.controller.test.ts`

**Interfaces:**
- Consumes: `findUserByUsernameWithHash` (existing), `upsertPasswordResetRequest` (Task 1).
- Produces: `POST /api/v1/auth/forgot-password` → always `204`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/auth.controller.test.ts` (adjust the relative import path to match the file's existing imports):

```ts
import { listPasswordResetRequests } from '../models/password-reset-request.model.ts';

test('POST /api/v1/auth/forgot-password 204s and queues a request for a known username', async () => {
  const { username } = await registerTestUser(baseUrl, 'Forgetful');

  const res = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  assert.equal(res.status, 204);

  const requests = await listPasswordResetRequests();
  assert.equal(requests.some((r) => r.username === username), true);
});

test('POST /api/v1/auth/forgot-password 204s without queuing anything for an unknown username', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no-such-user' }),
  });
  assert.equal(res.status, 204);
  assert.deepEqual(await listPasswordResetRequests(), []);
});

test('POST /api/v1/auth/forgot-password 204s on a malformed body', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 204);
});

test('a second forgot-password request for the same user does not duplicate the queue entry', async () => {
  const { username } = await registerTestUser(baseUrl, 'Forgetful2');

  for (let i = 0; i < 2; i++) {
    await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
  }

  const requests = await listPasswordResetRequests();
  assert.equal(requests.filter((r) => r.username === username).length, 1);
});
```

Run: `npm run test -w backend -- --test-name-pattern forgot-password`
Expected: FAIL — route not registered, so every request 404s.

- [ ] **Step 2: Implement the controller handler**

In `backend/src/controllers/auth.controller.ts`, add the import:

```ts
import { upsertPasswordResetRequest } from '../models/password-reset-request.model.ts';
```

Add the body schema and handler, after `logout`:

```ts
const forgotPasswordBody = z.object({ username: z.string().trim().min(1) });

/**
 * Always 204s, whether or not the username exists or is active — the
 * response must never let a signed-out caller distinguish a real account
 * from a made-up one.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (parsed.success) {
    const user = await findUserByUsernameWithHash(parsed.data.username);
    if (user) await upsertPasswordResetRequest(user.id);
  }
  res.status(204).end();
}
```

`findUserByUsernameWithHash` is already imported in this file.

- [ ] **Step 3: Register the route**

In `backend/src/routes/auth.routes.ts`, add directly after `register`:

```ts
authRouter.post('/register', auth.register);
authRouter.post('/forgot-password', auth.forgotPassword);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern forgot-password`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/routes/auth.routes.ts backend/src/controllers/auth.controller.test.ts
git commit -m "feat(auth): add public forgot-password endpoint"
```

---

### Task 5: Admin list/dismiss endpoints for pending requests

**Files:**
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `listPasswordResetRequests`, `deletePasswordResetRequest` (Task 1).
- Produces: `GET /api/v1/admin/password-reset-requests` → `{ requests: PendingPasswordResetRequest[] }`; `DELETE /api/v1/admin/password-reset-requests/:userId` → `204`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/admin-users.controller.test.ts`:

```ts
test('GET .../password-reset-requests lists a pending request', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { username } = await registerTestUser(baseUrl, 'Forgetful');

  await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  const res = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { requests: Array<{ username: string }> };
  assert.equal(body.requests.some((r) => r.username === username), true);
});

test('GET .../password-reset-requests 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('DELETE .../password-reset-requests/:userId dismisses a pending request', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Forgetful');

  await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  const del = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(del.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, { headers: { cookie } });
  const body = (await list.json()) as { requests: Array<{ username: string }> };
  assert.equal(body.requests.some((r) => r.username === username), false);
});

test('DELETE .../password-reset-requests/:userId is a no-op when there is nothing pending', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'NeverAsked');

  const res = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);
});

test('resetting a password also clears the pending request for that user', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Forgetful');

  await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { cookie },
  });

  const list = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, { headers: { cookie } });
  const body = (await list.json()) as { requests: Array<{ username: string }> };
  assert.equal(body.requests.some((r) => r.username === username), false);
});
```

Run: `npm run test -w backend -- --test-name-pattern password-reset-requests`
Expected: FAIL — routes don't exist yet (404s), and the last test fails because `deletePasswordResetRequest` isn't wired into `resetUserPassword` yet (it already is from Task 3 — this test just re-confirms it end-to-end through the new listing endpoint).

- [ ] **Step 2: Implement the controller handlers**

In `backend/src/controllers/admin-users.controller.ts`, update the import from `password-reset-request.model.ts`:

```ts
import { deletePasswordResetRequest, listPasswordResetRequests } from '../models/password-reset-request.model.ts';
```

Add the handlers, after `resetUserPassword`:

```ts
export async function getPasswordResetRequests(req: Request, res: Response): Promise<void> {
  const requests = await listPasswordResetRequests();
  res.json({ requests });
}

export async function dismissPasswordResetRequest(req: Request, res: Response): Promise<void> {
  const userId = param(req, 'userId');
  await deletePasswordResetRequest(userId);
  res.status(204).end();
}
```

- [ ] **Step 3: Register the routes**

In `backend/src/routes/admin.routes.ts`, add:

```ts
adminRouter.get('/password-reset-requests', adminUsers.getPasswordResetRequests);
adminRouter.delete('/password-reset-requests/:userId', adminUsers.dismissPasswordResetRequest);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern password-reset-requests`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `npm run test -w backend`
Expected: all tests pass (no regressions from Tasks 1–5).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(admin): list and dismiss pending password-reset requests"
```

---

### Task 6: Break-glass CLI script

**Files:**
- Create: `backend/src/scripts/reset-admin-password.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `findUserByUsernameWithHash`, `updatePasswordHash`, `forcePasswordChange`, `INITIAL_PASSWORD` (existing / Task 2).
- Produces: `resetAdminPassword(username: string, password: string): Promise<void>`, exported for potential reuse/testing, plus a `main()` CLI entry point.

- [ ] **Step 1: Write the script**

Create `backend/src/scripts/reset-admin-password.ts`:

```ts
import argon2 from 'argon2';
import { pool } from '../db/index.ts';
import {
  findUserByUsernameWithHash,
  forcePasswordChange,
  INITIAL_PASSWORD,
  updatePasswordHash,
} from '../models/user.model.ts';

/**
 * Bypasses the API/auth entirely — for the case where there is no other
 * admin available to do the reset through the UI. Resolves by username
 * (not id) since that's what an operator has on hand.
 */
export async function resetAdminPassword(username: string, password: string): Promise<void> {
  const user = await findUserByUsernameWithHash(username);
  if (!user) throw new Error(`No user found with username "${username}"`);

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await updatePasswordHash(user.id, passwordHash);
  await forcePasswordChange(user.id);
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD ?? INITIAL_PASSWORD;

  if (!username) {
    console.error('Set ADMIN_USERNAME, then re-run.');
    process.exit(1);
  }

  await resetAdminPassword(username, password);
  console.log(`Password reset for ${username}. They must change it on next login.`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json`, add directly after `"seed:admin"`:

```json
"seed:admin": "node --import tsx --env-file-if-exists=.env src/scripts/seed-admin.ts",
"reset-admin-password": "node --import tsx --env-file-if-exists=.env src/scripts/reset-admin-password.ts"
```

- [ ] **Step 3: Verify manually against the local dev database**

Run: `cd backend && npm run seed:admin` with `ADMIN_FIRST_NAME=Break ADMIN_LAST_NAME=Glass` set, to create a known admin (`bglass` / `liahwellness`), then:

Run: `ADMIN_USERNAME=bglass npm run reset-admin-password -w backend`
Expected: prints `Password reset for bglass. They must change it on next login.` and exits 0. (This is a manual verification step, not an automated test — `seed-admin.ts` has no test file either, same precedent.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/scripts/reset-admin-password.ts backend/package.json
git commit -m "feat(scripts): add break-glass admin password reset CLI"
```

---

### Task 7: Frontend `admin/api.ts` additions

**Files:**
- Modify: `frontend/src/admin/api.ts`
- Test: `frontend/src/admin/api.test.ts`

**Interfaces:**
- Produces: `PasswordResetRequest` type, `adminApi.resetPassword(userId: string): Promise<void>`, `adminApi.listPasswordRequests(): Promise<{ requests: PasswordResetRequest[] }>`, `adminApi.dismissPasswordRequest(userId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/admin/api.test.ts`:

```ts
test('resetPassword POSTs to the reset-password endpoint', async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 204, ok: true, json: async () => ({}) });

  await adminApi.resetPassword('u1');

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/admin/users/u1/reset-password',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('listPasswordRequests GETs the password-reset-requests endpoint', async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ requests: [] }),
  });

  await adminApi.listPasswordRequests();

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/admin/password-reset-requests',
    expect.objectContaining({ credentials: 'include' }),
  );
});

test('dismissPasswordRequest DELETEs the request for the given user', async () => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 204, ok: true, json: async () => ({}) });

  await adminApi.dismissPasswordRequest('u1');

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/admin/password-reset-requests/u1',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
```

Run: `npm run test -w frontend -- api.test.ts`
Expected: FAIL — `adminApi.resetPassword is not a function` (and likewise for the other two).

- [ ] **Step 2: Implement the additions**

In `frontend/src/admin/api.ts`, add the type near the other row types:

```ts
export type PasswordResetRequest = {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  requestedAt: string;
};
```

Add to the `adminApi` object, after `getUserAttempts`:

```ts
resetPassword: (id: string) => request<void>(`/admin/users/${id}/reset-password`, { method: 'POST' }),

listPasswordRequests: () => request<{ requests: PasswordResetRequest[] }>('/admin/password-reset-requests'),

dismissPasswordRequest: (userId: string) =>
  request<void>(`/admin/password-reset-requests/${userId}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm run test -w frontend -- api.test.ts`
Expected: all tests in the file PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/admin/api.ts frontend/src/admin/api.test.ts
git commit -m "feat(admin-ui): add password-reset API client methods"
```

---

### Task 8: `KeyIcon` + reset-password row action on `AdminUsersPage`

**Files:**
- Modify: `frontend/src/shell/icons.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Test: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `adminApi.resetPassword` (Task 7).
- Produces: `KeyIcon` component, exported from `icons.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/admin/AdminUsersPage.test.tsx`. First, extend the mocked `adminApi` and add a `resetPassword` spy near the other `vi.fn()` declarations:

```ts
const resetPassword = vi.fn();
```

Add it to the `vi.mock('../../admin/api', ...)` factory's `adminApi` object:

```ts
resetPassword: (id: string) => resetPassword(id),
```

Add to the `beforeEach`:

```ts
resetPassword.mockResolvedValue(undefined);
```

Add the test:

```ts
test('resetting a password calls the API and toasts a confirmation', async () => {
  render(<AdminUsersPage />);
  const row = (await screen.findByText('student')).closest('tr')!;

  fireEvent.click(within(row).getByRole('button', { name: 'Reset password' }));

  await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('u2'));
  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith('Password reset — user must set a new one at next login.'),
  );
});

test('the reset-password action is disabled for your own row', async () => {
  render(<AdminUsersPage />);
  const row = (await screen.findByText('adminuser')).closest('tr')!;

  expect(within(row).getByRole('button', { name: 'Reset password' })).toBeDisabled();
});
```

(`waitFor`, `within`, `fireEvent`, `screen` are already imported at the top of this test file; `toastSuccess` is the existing mocked `react-hot-toast` spy.)

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: FAIL — no button named "Reset password" exists yet.

- [ ] **Step 2: Add the icon**

In `frontend/src/shell/icons.tsx`, add after `RestoreIcon`:

```ts
/** A key: resetting a password. */
export function KeyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="15" r="3.2" />
      <path d="M10.3 12.7L19 4" />
      <path d="M15.5 8.5l2.5 2.5M18 6l2.5 2.5" />
    </svg>
  );
}
```

- [ ] **Step 3: Wire up the row action**

In `frontend/src/pages/admin/AdminUsersPage.tsx`, update the icons import:

```ts
import { ChevronRightIcon, KeyIcon, TrashIcon, UserIcon, UserMinusIcon } from '../../shell/icons';
```

Add a handler, after `remove`:

```ts
const resetPassword = async (target: AdminUser) => {
  setBusyId(target.id);
  try {
    await adminApi.resetPassword(target.id);
    toast.success('Password reset — user must set a new one at next login.');
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to reset password');
  } finally {
    setBusyId(null);
  }
};
```

Add the button, inside `<td className="admin-actions">`, directly before the delete button:

```tsx
<button
  type="button"
  className="icon-button"
  disabled={isSelf || busyId === u.id}
  onClick={() => void resetPassword(u)}
  aria-label="Reset password"
  title="Reset password"
>
  <KeyIcon className="icon-button-icon" />
</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shell/icons.tsx frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(admin-ui): add reset-password row action to the Users page"
```

---

### Task 9: `PasswordRequestsPage`

**Files:**
- Create: `frontend/src/pages/admin/PasswordRequestsPage.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/AccountMenu.tsx`
- Test: `frontend/src/pages/admin/PasswordRequestsPage.test.tsx`
- Test: `frontend/src/shell/AccountMenu.test.tsx`
- Test: `frontend/src/router.test.tsx`

**Interfaces:**
- Consumes: `adminApi.listPasswordRequests`, `adminApi.resetPassword`, `adminApi.dismissPasswordRequest` (Task 7), `KeyIcon` (Task 8).
- Produces: `PasswordRequestsPage` component; route `/admin/password-reset-requests`.

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/pages/admin/PasswordRequestsPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PasswordRequestsPage } from './PasswordRequestsPage';

const listPasswordRequests = vi.fn();
const resetPassword = vi.fn();
const dismissPasswordRequest = vi.fn();

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listPasswordRequests: () => listPasswordRequests(),
    resetPassword: (id: string) => resetPassword(id),
    dismissPasswordRequest: (userId: string) => dismissPasswordRequest(userId),
  },
}));

beforeEach(() => {
  listPasswordRequests.mockResolvedValue({
    requests: [
      {
        userId: 'u1',
        username: 'forgetful',
        firstName: 'For',
        lastName: 'Getful',
        requestedAt: '2026-11-06T00:00:00.000Z',
      },
    ],
  });
  resetPassword.mockResolvedValue(undefined);
  dismissPasswordRequest.mockResolvedValue(undefined);
  toastSuccess.mockReset();
});

describe('PasswordRequestsPage', () => {
  test('lists pending requests', async () => {
    render(<PasswordRequestsPage />);
    expect(await screen.findByText('forgetful')).toBeInTheDocument();
  });

  test('shows an empty state with no pending requests', async () => {
    listPasswordRequests.mockResolvedValue({ requests: [] });
    render(<PasswordRequestsPage />);
    expect(await screen.findByText('No pending password reset requests.')).toBeInTheDocument();
  });

  test('resetting a request calls the API, removes the row, and toasts', async () => {
    render(<PasswordRequestsPage />);
    const row = (await screen.findByText('forgetful')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('forgetful')).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Password reset — user must set a new one at next login.');
  });

  test('dismissing a request calls the API, removes the row, and toasts', async () => {
    render(<PasswordRequestsPage />);
    const row = (await screen.findByText('forgetful')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(dismissPasswordRequest).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('forgetful')).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Request dismissed.');
  });
});
```

Run: `npm run test -w frontend -- PasswordRequestsPage.test.tsx`
Expected: FAIL — `Cannot find module './PasswordRequestsPage'`.

- [ ] **Step 2: Implement the page**

Create `frontend/src/pages/admin/PasswordRequestsPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type PasswordResetRequest } from '../../admin/api';
import { KeyIcon, TrashIcon } from '../../shell/icons';

export function PasswordRequestsPage() {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listPasswordRequests()
      .then((res) => setRequests(res.requests))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetPassword = async (request: PasswordResetRequest) => {
    setBusyId(request.userId);
    try {
      await adminApi.resetPassword(request.userId);
      toast.success('Password reset — user must set a new one at next login.');
      setRequests((prev) => prev.filter((r) => r.userId !== request.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (request: PasswordResetRequest) => {
    setBusyId(request.userId);
    try {
      await adminApi.dismissPasswordRequest(request.userId);
      toast.success('Request dismissed.');
      setRequests((prev) => prev.filter((r) => r.userId !== request.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss request');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Password Requests</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : requests.length === 0 ? (
        <p>No pending password reset requests.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.userId}>
                <td data-label="Username">{r.username}</td>
                <td data-label="First Name">{r.firstName ?? '—'}</td>
                <td data-label="Last Name">{r.lastName ?? '—'}</td>
                <td data-label="Requested">{new Date(r.requestedAt).toLocaleString()}</td>
                <td className="admin-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === r.userId}
                    onClick={() => void resetPassword(r)}
                    aria-label="Reset password"
                    title="Reset password"
                  >
                    <KeyIcon className="icon-button-icon" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === r.userId}
                    onClick={() => void dismiss(r)}
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <TrashIcon className="icon-button-icon" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the page test to verify it passes**

Run: `npm run test -w frontend -- PasswordRequestsPage.test.tsx`
Expected: all 4 tests PASS.

- [ ] **Step 4: Write the failing nav-link test**

Add to `frontend/src/shell/AccountMenu.test.tsx`, inside the existing `'a plain user sees Profile and Sign out but no admin links'` test, add one more assertion line, and add a new test:

```ts
expect(screen.queryByText('Admin · Password Requests')).not.toBeInTheDocument();
```

```ts
test('an admin sees the Password Requests link after Recycle Bin', () => {
  renderMenu('admin');
  fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  const recycleBinIndex = items.findIndex((t) => t?.includes('Admin · Recycle Bin'));
  const requestsIndex = items.findIndex((t) => t?.includes('Admin · Password Requests'));

  expect(recycleBinIndex).toBeLessThan(requestsIndex);
});
```

Run: `npm run test -w frontend -- AccountMenu.test.tsx`
Expected: FAIL — no "Admin · Password Requests" link exists yet.

- [ ] **Step 5: Add the nav link**

In `frontend/src/shell/AccountMenu.tsx`, add directly after the "Admin · Recycle Bin" `<li>`:

```tsx
<li>
  <NavLink to="/admin/recycle-bin" className="account-menu-item" onClick={() => setOpen(false)}>
    <CogIcon className="nav-icon" />
    Admin · Recycle Bin
  </NavLink>
</li>
<li>
  <NavLink
    to="/admin/password-reset-requests"
    className="account-menu-item"
    onClick={() => setOpen(false)}
  >
    <CogIcon className="nav-icon" />
    Admin · Password Requests
  </NavLink>
</li>
```

- [ ] **Step 6: Run the nav test to verify it passes**

Run: `npm run test -w frontend -- AccountMenu.test.tsx`
Expected: all tests in the file PASS.

- [ ] **Step 7: Write the failing route test**

Add to `frontend/src/router.test.tsx`, a test mirroring the existing admin-route tests in that file (check the top of the file for the `useAuth` mock setup already present):

```tsx
test('an admin can reach /admin/password-reset-requests', () => {
  useAuth.mockReturnValue({
    user: { id: 'u1', username: 'adminuser', role: 'admin', mustChangePassword: false, createdAt: '2026-11-02T12:00:00.000Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
  });
  at('/admin/password-reset-requests');
  expect(screen.getByText('Password Requests')).toBeInTheDocument();
});

test('a non-admin hitting /admin/password-reset-requests sees the 404 page', () => {
  at('/admin/password-reset-requests');
  expect(screen.getByText('404')).toBeInTheDocument();
});
```

(The second test relies on the `beforeEach` default mock, which is a `role: 'user'`.)

Run: `npm run test -w frontend -- router.test.tsx`
Expected: FAIL — the route isn't registered, so both requests hit the catch-all 404 route (the admin one unexpectedly 404s too).

- [ ] **Step 8: Register the route**

In `frontend/src/router.tsx`, add the import:

```ts
import { PasswordRequestsPage } from './pages/admin/PasswordRequestsPage';
```

Add the route, directly after `/admin/recycle-bin`:

```tsx
<Route
  path="/admin/recycle-bin"
  element={
    <RequireAdmin>
      <RecycleBinPage />
    </RequireAdmin>
  }
/>
<Route
  path="/admin/password-reset-requests"
  element={
    <RequireAdmin>
      <PasswordRequestsPage />
    </RequireAdmin>
  }
/>
```

- [ ] **Step 9: Run the route tests to verify they pass**

Run: `npm run test -w frontend -- router.test.tsx`
Expected: all tests in the file PASS.

- [ ] **Step 10: Run the full frontend suite**

Run: `npm run test -w frontend`
Expected: all tests pass (no regressions).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/admin/PasswordRequestsPage.tsx frontend/src/pages/admin/PasswordRequestsPage.test.tsx frontend/src/shell/AccountMenu.tsx frontend/src/shell/AccountMenu.test.tsx frontend/src/router.tsx frontend/src/router.test.tsx
git commit -m "feat(admin-ui): add Password Requests page for reviewing forgot-password requests"
```

---

### Task 10: Login page "Forgot password?" flow

**Files:**
- Modify: `frontend/src/auth/api.ts`
- Modify: `frontend/src/auth/LoginForm.tsx`
- Test: `frontend/src/auth/LoginForm.test.tsx`

**Interfaces:**
- Produces: `authApi.forgotPassword(username: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/auth/LoginForm.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from './LoginForm';

const login = vi.fn();
const register = vi.fn();
const forgotPassword = vi.fn();

vi.mock('./useAuth', () => ({
  useAuth: () => ({ login: (u: string, p: string) => login(u, p), register }),
}));

vi.mock('./api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: { forgotPassword: (username: string) => forgotPassword(username) },
}));

beforeEach(() => {
  login.mockReset();
  register.mockReset();
  forgotPassword.mockReset().mockResolvedValue(undefined);
});

describe('LoginForm forgot-password flow', () => {
  test('clicking "Forgot password?" switches to the username-only form', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('button', { name: 'Notify admin' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });

  test('carries over whatever username was already typed', () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByPlaceholderText('Username')).toHaveValue('jdoe');
  });

  test('submitting calls forgotPassword and shows a neutral confirmation', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify admin' }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('jdoe'));
    expect(
      await screen.findByText('If that username exists, an admin has been notified.'),
    ).toBeInTheDocument();
  });

  test('shows the same confirmation even when the request fails', async () => {
    forgotPassword.mockRejectedValue(new Error('network error'));
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'jdoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify admin' }));

    expect(
      await screen.findByText('If that username exists, an admin has been notified.'),
    ).toBeInTheDocument();
  });

  test('"Back to sign in" returns to the login form', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });
});
```

Run: `npm run test -w frontend -- LoginForm.test.tsx`
Expected: FAIL — no "Forgot password?" button exists yet, and `authApi.forgotPassword` doesn't exist.

- [ ] **Step 2: Add the API method**

In `frontend/src/auth/api.ts`, add to the `authApi` object, after `register`:

```ts
forgotPassword: (username: string) =>
  request<void>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ username }),
  }),
```

- [ ] **Step 3: Implement the form changes**

Replace the full contents of `frontend/src/auth/LoginForm.tsx`:

```tsx
import { useState, type SubmitEvent } from 'react';
import liahLogo from '../assets/liah-logo.png';
import { authApi, MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register' | 'forgot';

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

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

  async function handleForgotSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authApi.forgotPassword(username);
    } catch {
      // Intentionally ignored: the confirmation below is shown either way, so
      // a signed-out caller can never tell a real username from a made-up one.
    } finally {
      setSubmitting(false);
      setForgotSent(true);
    }
  }

  if (mode === 'forgot') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <header className="auth-head">
            <img src={liahLogo} alt="LIAH Learning" className="auth-mark" />
            <h1>Forgot your password?</h1>
          </header>

          {forgotSent ? (
            <p>If that username exists, an admin has been notified.</p>
          ) : (
            <form onSubmit={(e) => void handleForgotSubmit(e)} className="auth-form">
              <div className="auth-fields">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  aria-label="Username"
                  autoComplete="username"
                  required
                />
              </div>

              <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
                {submitting ? 'Working…' : 'Notify admin'}
              </button>
            </form>
          )}

          <p className="auth-switch">
            <button
              type="button"
              className="auth-toggle"
              onClick={() => {
                setMode('login');
                setForgotSent(false);
              }}
            >
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    );
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

          {mode === 'login' && (
            <button
              type="button"
              className="auth-toggle"
              onClick={() => {
                setMode('forgot');
                setForgotSent(false);
                setError(null);
              }}
            >
              Forgot password?
            </button>
          )}
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w frontend -- LoginForm.test.tsx`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full frontend suite**

Run: `npm run test -w frontend`
Expected: all tests pass (no regressions — in particular, confirm nothing else imports `LoginForm`'s old single-return-value shape in a way that breaks).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/auth/LoginForm.tsx frontend/src/auth/LoginForm.test.tsx
git commit -m "feat(auth): add forgot-password flow to the login page"
```

---

### Task 11: Full-suite sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `npm run test -w backend`
Expected: all tests pass.

- [ ] **Step 2: Run the full frontend suite**

Run: `npm run test -w frontend`
Expected: all tests pass.

- [ ] **Step 3: Typecheck both workspaces**

Run: `npm run typecheck`
Expected: exits 0 with no type errors.

- [ ] **Step 4: Manual smoke test**

Start the app (`npm run dev`), as an admin: open the account menu → "Admin · Password Requests" → confirm the empty state renders. In a different browser/incognito window, go to the login page → "Forgot password?" → submit a known username → confirm the neutral confirmation message appears. Back in the admin tab, reload the Password Requests page → confirm the request appears → click "Reset password" → confirm it disappears and a toast appears. Log in as that user with username/`liahwellness` → confirm the forced password-change screen appears.

No commit for this task — it's verification only.

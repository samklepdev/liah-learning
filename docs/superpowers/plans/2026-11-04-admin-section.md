# Admin Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin user management of accounts (list, promote/demote, delete,
view attempt history) and a way to import quiz-pack PDFs through the UI, gated behind
a new `role` column on `users`.

**Architecture:** A `requireAdmin` middleware sits after the existing `requireAuth` and
checks `req.user.role`. Admin-only backend routes live under `/api/admin`, built from
new model functions on the existing `users` table plus the already-exported
`parseQuizPack` / `seedSubject` functions from the quiz pipeline — no new parsing or
seeding logic. The frontend adds two pages under `/admin/*`, reusing the existing
`AppShell` and `authApi`-style request helper, with a sidebar section visible only to
admins.

**Tech Stack:** Express 5, Drizzle ORM, PostgreSQL, Zod, multer (new dependency, for
multipart PDF upload), React 19, react-router.

## Global Constraints

- TypeScript stays pinned to `~6.0.3` — do not bump it.
- Schema changes go through `npm run db:push -w backend` (drizzle-kit push); this repo
  has no migration files, only `schema.ts`.
- Every new backend module file ends in `.ts` and is imported with an explicit `.ts`
  extension (this repo's existing convention, e.g. `from '../db/index.ts'`).
- Tests run with `node --test` on the backend (`npm run test -w backend`) and Vitest on
  the frontend (`npm run test -w frontend`); both must pass before any task is
  considered done.
- An admin can never demote or delete their own account (zero-admin lockout guard).
- Non-admins hitting an admin route get a 404, never a 403 or 401-after-login, matching
  the existing "don't confirm it exists" pattern.

---

### Task 1: Add `role` to the `users` table

**Files:**
- Modify: `backend/src/models/schema.ts`
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/models/session.model.ts`
- Modify: `backend/src/types/express.d.ts` (no change needed — it already types
  `req.user` as `PublicUser`, which is about to gain `role`)
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `PublicUser` now includes `role: 'user' | 'admin'`. Every later task that
  reads `req.user.role` or calls `listUsers` / `setUserRole` / `deleteUser` depends on
  this.

- [ ] **Step 1: Add the column to the schema**

Edit `backend/src/models/schema.ts`. In the `users` table definition, add `role` right
after `passwordHash`:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased and trimmed; see normalizeEmail(). */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push the schema change**

Run: `npm run db:push -w backend`
Expected: drizzle-kit reports the `role` column added to `users`, no destructive
changes prompted. Also run against the test database:

Run: `npm run db:push:test -w backend`
Expected: same, against `.env.test`'s database.

- [ ] **Step 3: Write the failing test for the model changes**

Create `backend/src/models/user.model.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser } from './user.model.ts';

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
  const user = await createUser('role-default@example.com', 'hash');
  assert.equal(user?.role, 'user');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "defaults role"`
Expected: FAIL — `user?.role` is `undefined` because `PublicUser` and `publicColumns`
don't select it yet.

- [ ] **Step 5: Expose `role` from the model**

Edit `backend/src/models/user.model.ts`:

```ts
/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<User, 'id' | 'email' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};
```

The rest of `createUser` and `findUserByEmailWithHash` already spread `publicColumns`,
so no other change is needed in this file.

Edit `backend/src/models/session.model.ts` — `findUserBySessionId`'s explicit select
needs the new column:

```ts
export async function findUserBySessionId(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "defaults role"`
Expected: PASS

- [ ] **Step 7: Typecheck and full backend test run**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: no type errors; all existing tests still pass (login/register responses now
carry `role`, which no existing assertion checks for exact shape equality, so nothing
should break — if any test does assert exact response shape, add `role: 'user'` to its
expected object).

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/schema.ts backend/src/models/user.model.ts backend/src/models/session.model.ts backend/src/models/user.model.test.ts
git commit -m "feat(api): add role column to users"
```

---

### Task 2: `requireAdmin` middleware

**Files:**
- Modify: `backend/src/middleware/auth.middleware.ts`
- Test: `backend/src/middleware/auth.middleware.test.ts`

**Interfaces:**
- Consumes: `req.user: PublicUser | undefined` (from Task 1, already attached by
  `attachUser`).
- Produces: `requireAdmin(req, res, next)` — an Express middleware. Later admin routes
  mount it as `requireAuth, requireAdmin`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/auth.middleware.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAdmin } from './auth.middleware.ts';
import type { PublicUser } from '../models/user.model.ts';

function appWith(user: PublicUser | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/probe', requireAdmin, (_req, res) => res.json({ ok: true }));
  return app;
}

function adminUser(): PublicUser {
  return { id: 'u1', email: 'admin@example.com', role: 'admin', createdAt: new Date() };
}

function plainUser(): PublicUser {
  return { id: 'u2', email: 'user@example.com', role: 'user', createdAt: new Date() };
}

test('requireAdmin passes through for an admin', async () => {
  const server = appWith(adminUser()).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 200);
  server.close();
});

test('requireAdmin 404s for a signed-in non-admin', async () => {
  const server = appWith(plainUser()).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 404);
  server.close();
});

test('requireAdmin 404s when signed out', async () => {
  const server = appWith(undefined).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 404);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "requireAdmin"`
Expected: FAIL with "requireAdmin is not a function" (not exported yet).

- [ ] **Step 3: Implement `requireAdmin`**

Edit `backend/src/middleware/auth.middleware.ts`, add after `requireAuth`:

```ts
/**
 * Gates a route behind an admin session. Must run after requireAuth (or at
 * least after attachUser). Answers 404, not 403 — a non-admin should not be
 * able to tell an admin route exists.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "requireAdmin"`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/auth.middleware.ts backend/src/middleware/auth.middleware.test.ts
git commit -m "feat(api): add requireAdmin middleware"
```

---

### Task 3: Admin user management — model, controller, routes

**Files:**
- Create: `backend/src/models/admin-user.model.ts`
- Create: `backend/src/controllers/admin-users.controller.ts`
- Create: `backend/src/routes/admin.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `PublicUser`, `requireAuth`, `requireAdmin` (Tasks 1–2); `db`, `schema.users`
  from `backend/src/db/index.ts` and `backend/src/models/schema.ts`.
- Produces:
  - `listUsers(): Promise<PublicUser[]>`
  - `setUserRole(id: string, role: 'user' | 'admin'): Promise<PublicUser | null>`
  - `deleteUserById(id: string): Promise<boolean>`
  - Routes: `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`,
    `DELETE /api/admin/users/:id` — all mounted under `apiRouter` and consumed by the
    frontend `adminApi` in Task 7.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/admin-users.controller.test.ts`:

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

async function makeAdmin(email: string) {
  const { cookie, userId } = await registerTestUser(baseUrl, email);
  await setUserRole(userId, 'admin');
  return { cookie, userId };
}

test('GET /api/admin/users 404s for a signed-in non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const res = await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('GET /api/admin/users lists users for an admin', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { users: Array<{ email: string }> };
  const emails = body.users.map((u) => u.email).sort();
  assert.deepEqual(emails, ['admin@example.com', 'student@example.com']);
});

test('PATCH role promotes a user to admin', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { userId } = await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string } };
  assert.equal(body.user.role, 'admin');
});

test('PATCH role rejects an admin demoting themselves', async () => {
  const { cookie, userId } = await makeAdmin('admin@example.com');

  const res = await fetch(`${baseUrl}/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE removes a user', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { userId } = await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { users: Array<{ email: string }> };
  assert.equal(body.users.some((u) => u.email === 'student@example.com'), false);
});

test('DELETE rejects an admin deleting themselves', async () => {
  const { cookie, userId } = await makeAdmin('admin@example.com');

  const res = await fetch(`${baseUrl}/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "admin/users"`
Expected: FAIL — `admin-user.model.ts` and the routes don't exist yet.

- [ ] **Step 3: Write the model**

Create `backend/src/models/admin-user.model.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from './schema.ts';
import type { PublicUser } from './user.model.ts';

const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

export async function listUsers(): Promise<PublicUser[]> {
  return db.select(publicColumns).from(users).orderBy(users.createdAt);
}

export async function setUserRole(
  id: string,
  role: 'user' | 'admin',
): Promise<PublicUser | null> {
  const [row] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning(publicColumns);
  return row ?? null;
}

/** True if a row was deleted. */
export async function deleteUserById(id: string): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return result.length > 0;
}
```

- [ ] **Step 4: Write the controller**

Create `backend/src/controllers/admin-users.controller.ts`:

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { deleteUserById, listUsers, setUserRole } from '../models/admin-user.model.ts';

const roleBody = z.object({ role: z.enum(['user', 'admin']) });

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await listUsers();
  res.json({ users });
}

export async function patchUserRole(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot change your own role' });
    return;
  }

  const parsed = roleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const user = await setUserRole(id, parsed.data.role);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const deleted = await deleteUserById(id);
  if (!deleted) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(204).end();
}
```

- [ ] **Step 5: Write the routes and mount them**

Create `backend/src/routes/admin.routes.ts`:

```ts
import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
```

Edit `backend/src/routes/index.ts`:

```ts
import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware.ts';
import { adminRouter } from './admin.routes.ts';
import { authRouter } from './auth.routes.ts';
import { catalogRouter } from './catalog.routes.ts';
import { quizRouter } from './quiz.routes.ts';

/** Everything under /api. Mounted once in app.ts. */
export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/', catalogRouter);
apiRouter.use('/', quizRouter);
apiRouter.use('/admin', requireAuth, requireAdmin, adminRouter);

// Example of a gated route — anything behind requireAuth gets req.user.
apiRouter.get('/me/dashboard', requireAuth, (req: Request, res: Response) => {
  res.json({ message: `Welcome back, ${req.user!.email}` });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "admin/users"`
Expected: PASS, all six cases.

- [ ] **Step 7: Typecheck and full backend test run**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/admin-user.model.ts backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/routes/index.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(api): add admin user management endpoints"
```

---

### Task 4: Admin view of a user's attempt history

**Files:**
- Create: `backend/src/models/admin-attempt.model.ts`
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts` (extend)

**Interfaces:**
- Consumes: `attempts`, `courses`, `subjects` from `schema.ts`; `db` from
  `db/index.ts`.
- Produces: `listAttemptsForUser(userId: string): Promise<AdminAttemptRow[]>` where
  `AdminAttemptRow = { id: string; courseTitle: string; courseSlug: string;
  subjectSlug: string; score: number | null; startedAt: Date; submittedAt: Date | null
  }`. Route: `GET /api/admin/users/:id/attempts`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/controllers/admin-users.controller.test.ts`:

```ts
test('GET /api/admin/users/:id/attempts lists that user\'s attempts', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { cookie: studentCookie, userId } = await registerTestUser(
    baseUrl,
    'student@example.com',
  );

  // The student has no course content seeded in this test's empty DB, so this
  // only exercises the empty-list path — content-bearing cases are covered by
  // the quiz/attempt lifecycle tests elsewhere.
  const res = await fetch(`${baseUrl}/api/admin/users/${userId}/attempts`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attempts: unknown[] };
  assert.deepEqual(body.attempts, []);
  void studentCookie;
});

test('GET /api/admin/users/:id/attempts 404s for an unknown user', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const res = await fetch(
    `${baseUrl}/api/admin/users/00000000-0000-0000-0000-000000000000/attempts`,
    { headers: { cookie } },
  );
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "attempts"`
Expected: FAIL — route doesn't exist (404 from the router's catch-all, but the test
expecting `[]` on 200 fails since there's no route at all yet — both assertions fail
for the same underlying reason).

- [ ] **Step 3: Write the model**

Create `backend/src/models/admin-attempt.model.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';

export type AdminAttemptRow = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
};

export async function listAttemptsForUser(userId: string): Promise<AdminAttemptRow[]> {
  return db
    .select({
      id: attempts.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      subjectSlug: subjects.slug,
      score: attempts.score,
      startedAt: attempts.startedAt,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(eq(attempts.userId, userId))
    .orderBy(desc(attempts.startedAt));
}
```

- [ ] **Step 4: Add the controller action**

Edit `backend/src/controllers/admin-users.controller.ts`, add import and function:

```ts
import { listAttemptsForUser } from '../models/admin-attempt.model.ts';
import { findUserByEmailWithHash } from '../models/user.model.ts';
```

Wait — there's no "find user by id" helper yet. Add one to
`backend/src/models/admin-user.model.ts` instead of reusing the email lookup:

```ts
export async function findUserById(id: string): Promise<PublicUser | null> {
  const [row] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
```

Now in `backend/src/controllers/admin-users.controller.ts`, update the import and add
the handler:

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { listAttemptsForUser } from '../models/admin-attempt.model.ts';
import {
  deleteUserById,
  findUserById,
  listUsers,
  setUserRole,
} from '../models/admin-user.model.ts';

// ... getUsers, patchUserRole, deleteUser unchanged ...

export async function getUserAttempts(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const user = await findUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const attempts = await listAttemptsForUser(id);
  res.json({ attempts });
}
```

- [ ] **Step 5: Add the route**

Edit `backend/src/routes/admin.routes.ts`:

```ts
import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "attempts"`
Expected: PASS, both cases.

- [ ] **Step 7: Typecheck and full backend test run**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/admin-attempt.model.ts backend/src/models/admin-user.model.ts backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(api): add admin endpoint for a user's attempt history"
```

---

### Task 5: PDF parse preview endpoint

**Files:**
- Modify: `backend/package.json` (add `multer`, `@types/multer`)
- Create: `backend/src/controllers/admin-import.controller.ts`
- Create: `backend/src/routes/admin-import.routes.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-import.controller.test.ts`

**Interfaces:**
- Consumes: `parseQuizPack`, `QuizParseError`, `slugify`, `ParsedSubject` from
  `backend/src/lib/quiz-parser.ts` (already exported, unchanged).
- Produces: `POST /api/admin/import/parse` — multipart form with a `pdf` file field and
  a `subjectTitle` text field. Responds `200 { subject: ParsedSubject, summary: {
  courses: number, questions: number } }` on success, or `422 { errors: string[] }` on
  a parse failure. This `subject` payload is what Task 6's `/confirm` consumes.

- [ ] **Step 1: Add multer**

Edit `backend/package.json`, add to `dependencies`:

```json
    "multer": "^2.0.1",
```

and to `devDependencies`:

```json
    "@types/multer": "^2.0.0",
```

Run: `npm install`
Expected: lockfile updated, no peer conflicts (multer 2.x supports Express 5).

- [ ] **Step 2: Write the failing test**

Create `backend/src/controllers/admin-import.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

async function adminCookie() {
  const { cookie, userId } = await registerTestUser(baseUrl, 'admin@example.com');
  await setUserRole(userId, 'admin');
  return cookie;
}

function chassisFixtureAsPdfText(): string {
  // The parser's input is pdftotext's *output*, not a PDF. The test fixture
  // is already that plain-text form (see lib/quiz-parser.test.ts), so the
  // controller test posts it as the upload body and the controller is
  // structured to accept pre-extracted text in tests — see Step 3's note on
  // the EXTRACT_TEXT seam.
  return readFileSync(new URL('../test/fixtures/chassis.txt', import.meta.url), 'utf8');
}

test('POST /api/admin/import/parse returns a summary for a good pack', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');

  const res = await fetch(`${baseUrl}/api/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { summary: { courses: number; questions: number } };
  assert.equal(body.summary.courses, 11);
  assert.equal(body.summary.questions, 110);
});

test('POST /api/admin/import/parse 422s with errors for a malformed pack', async () => {
  const cookie = await adminCookie();
  const malformed = readFileSync(new URL('../test/fixtures/malformed.txt', import.meta.url), 'utf8');
  const form = new FormData();
  form.append('pdf', new Blob([malformed], { type: 'text/plain' }), 'bad.txt');
  form.append('subjectTitle', 'Bad');

  const res = await fetch(`${baseUrl}/api/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { errors: string[] };
  assert.equal(body.errors.length, 1);
});

test('POST /api/admin/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const form = new FormData();
  form.append('pdf', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  form.append('subjectTitle', 'X');

  const res = await fetch(`${baseUrl}/api/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 404);
});
```

This test uploads plain extracted text, not a real PDF, bypassing `pdftotext`
entirely — matching how `lib/quiz-parser.test.ts` already tests the parser, and
avoiding a `pdftotext`/poppler dependency in CI. The controller achieves this by
running `pdftotext` only when the upload's extension is `.pdf`; a `.txt` upload (as
in tests) is read as already-extracted text. Real browser uploads are always `.pdf`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "import/parse"`
Expected: FAIL — route and controller don't exist yet.

- [ ] **Step 4: Write the controller**

Create `backend/src/controllers/admin-import.controller.ts`:

```ts
import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseQuizPack, QuizParseError, slugify, type ParsedSubject } from '../lib/quiz-parser.ts';

/** 10MB is comfortably above any of the eight existing subject packs. */
export const uploadPdf = multer({ limits: { fileSize: 10 * 1024 * 1024 } }).single('pdf');

const titleBody = z.object({ subjectTitle: z.string().trim().min(1) });

/**
 * Runs pdftotext on a real PDF upload. A .txt upload (used by tests, which
 * post pre-extracted text to avoid a pdftotext/poppler dependency in CI) is
 * used as-is.
 */
function extractText(file: Express.Multer.File): string {
  if (file.originalname.toLowerCase().endsWith('.txt')) {
    return file.buffer.toString('utf8');
  }
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: file.buffer,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

export async function parseImport(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded under field "pdf"' });
    return;
  }

  const parsedBody = titleBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: z.prettifyError(parsedBody.error) });
    return;
  }
  const { subjectTitle } = parsedBody.data;
  const subjectSlug = slugify(subjectTitle);

  let text: string;
  try {
    text = extractText(file);
  } catch {
    res.status(422).json({ errors: ['Could not extract text from the uploaded file.'] });
    return;
  }

  try {
    const subject: ParsedSubject = parseQuizPack(text, { subjectSlug, subjectTitle });
    const questionCount = subject.courses.reduce((n, c) => n + c.questions.length, 0);
    res.json({
      subject,
      summary: { courses: subject.courses.length, questions: questionCount },
    });
  } catch (err) {
    if (err instanceof QuizParseError) {
      res.status(422).json({ errors: [err.message] });
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Wire the route**

Create `backend/src/routes/admin-import.routes.ts`:

```ts
import { Router } from 'express';
import * as adminImport from '../controllers/admin-import.controller.ts';

export const adminImportRouter = Router();

adminImportRouter.post('/parse', adminImport.uploadPdf, adminImport.parseImport);
```

Edit `backend/src/routes/admin.routes.ts` to mount it:

```ts
import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';
import { adminImportRouter } from './admin-import.routes.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
adminRouter.use('/import', adminImportRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "import/parse"`
Expected: PASS, all three cases.

- [ ] **Step 7: Typecheck and full backend test run**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: clean. If `express.json({ limit: '100kb' })` in `app.ts` causes issues for
multipart bodies: it does not — multer reads `multipart/form-data` directly from the
raw request stream before Express's JSON body parser would apply, and `express.json`
ignores non-JSON content types, so no change to `app.ts` is needed.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/controllers/admin-import.controller.ts backend/src/routes/admin-import.routes.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-import.controller.test.ts
git commit -m "feat(api): add admin PDF parse-preview endpoint"
```

---

### Task 6: Import confirm endpoint

**Files:**
- Modify: `backend/src/controllers/admin-import.controller.ts`
- Modify: `backend/src/routes/admin-import.routes.ts`
- Test: `backend/src/controllers/admin-import.controller.test.ts` (extend)

**Interfaces:**
- Consumes: `seedSubject(subject: ParsedSubject): Promise<{ courses: number;
  questions: number }>` from `backend/src/scripts/seed-quizzes.ts` (already exported,
  unchanged).
- Produces: `POST /api/admin/import/confirm`, body `{ subject: ParsedSubject }` ->
  `200 { courses: number, questions: number }`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/controllers/admin-import.controller.test.ts`:

```ts
test('POST /api/admin/import/confirm seeds the parsed subject', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');

  const parseRes = await fetch(`${baseUrl}/api/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  const { subject } = (await parseRes.json()) as { subject: unknown };

  const confirmRes = await fetch(`${baseUrl}/api/admin/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject }),
  });
  assert.equal(confirmRes.status, 200);
  const body = (await confirmRes.json()) as { courses: number; questions: number };
  assert.equal(body.courses, 11);
  assert.equal(body.questions, 110);
});

test('POST /api/admin/import/confirm is idempotent on re-import', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');
  const { subject } = (await (
    await fetch(`${baseUrl}/api/admin/import/parse`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
  ).json()) as { subject: unknown };

  const confirm = () =>
    fetch(`${baseUrl}/api/admin/import/confirm`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject }),
    });

  await confirm();
  const second = await confirm();
  assert.equal(second.status, 200);

  const list = await fetch(`${baseUrl}/api/subjects`);
  const body = (await list.json()) as { subjects: unknown[] };
  assert.equal(body.subjects.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "import/confirm"`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement**

Edit `backend/src/controllers/admin-import.controller.ts`, add import and handler:

```ts
import { seedSubject } from '../scripts/seed-quizzes.ts';
```

```ts
const confirmBody = z.object({
  subject: z.object({
    slug: z.string(),
    title: z.string(),
    courses: z.array(z.unknown()),
  }),
});

export async function confirmImport(req: Request, res: Response): Promise<void> {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const result = await seedSubject(parsed.data.subject as ParsedSubject);
  res.json(result);
}
```

The `courses: z.array(z.unknown())` keeps validation shallow here deliberately —
`parseQuizPack` already validated the full shape when it produced this payload in
`/parse`; `/confirm` just needs to confirm it received an object shaped like a subject
before re-trusting it as `ParsedSubject`, not re-run every assertion the parser already
made.

Edit `backend/src/routes/admin-import.routes.ts`:

```ts
import { Router } from 'express';
import * as adminImport from '../controllers/admin-import.controller.ts';

export const adminImportRouter = Router();

adminImportRouter.post('/parse', adminImport.uploadPdf, adminImport.parseImport);
adminImportRouter.post('/confirm', adminImport.confirmImport);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "import/confirm"`
Expected: PASS, both cases.

- [ ] **Step 5: Typecheck and full backend test run**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: clean. Note the `/confirm` route's JSON body (the full parsed subject) can
exceed the global `express.json({ limit: '100kb' })` cap in `app.ts` for a full
110-question subject. Check actual size:

Run: `wc -c backend/src/data/chassis.quiz.json`
Expected: an output around 60-80KB (per the existing design doc's "~60KB per subject"
estimate) — under 100kb, so no change needed. If this ever grows past the limit for a
larger pack, that is a separate, later fix (raise the limit only on this route via
`express.json({ limit: '1mb' })` passed as route-level middleware), not something to
pre-emptively guard against here.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin-import.controller.ts backend/src/routes/admin-import.routes.ts backend/src/controllers/admin-import.controller.test.ts
git commit -m "feat(api): add admin PDF import confirm endpoint"
```

---

### Task 7: Frontend admin API client and `User.role`

**Files:**
- Modify: `frontend/src/auth/api.ts`
- Create: `frontend/src/admin/api.ts`
- Test: `frontend/src/admin/api.test.ts`

**Interfaces:**
- Consumes: the `request<T>()` helper pattern already in `auth/api.ts`.
- Produces:
  - `User` now has `role: 'user' | 'admin'`.
  - `adminApi.listUsers()`, `adminApi.setRole(id, role)`, `adminApi.deleteUser(id)`,
    `adminApi.getUserAttempts(id)`, `adminApi.parseImport(file, subjectTitle)`,
    `adminApi.confirmImport(subject)` — consumed by Tasks 9 and 10's pages.
  - Types: `AdminUser`, `AdminAttempt`, `ImportSummary`, `ImportErrors`.

- [ ] **Step 1: Add `role` to `User`**

Edit `frontend/src/auth/api.ts`:

```ts
export type User = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
};
```

Also export the shared `request` helper so `admin/api.ts` can reuse it without
duplicating the fetch wrapper:

```ts
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // ... existing body unchanged ...
}
```

(Remove the `async function request` -> keep implementation identical, just change
`async function request` to `export async function request`.)

- [ ] **Step 2: Write the failing test**

Create `frontend/src/admin/api.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { adminApi } from './api';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('adminApi', () => {
  test('listUsers GETs /api/admin/users', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ users: [] }),
    });

    await adminApi.listUsers();

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  test('setRole PATCHes the role endpoint with the new role', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ user: { id: 'u1', email: 'a@b.com', role: 'admin', createdAt: '' } }),
    });

    await adminApi.setRole('u1', 'admin');

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users/u1/role',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      }),
    );
  });

  test('parseImport posts multipart form data without a JSON content-type header', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ subject: {}, summary: { courses: 1, questions: 10 } }),
    });

    const file = new File(['pdf-bytes'], 'chassis.pdf', { type: 'application/pdf' });
    await adminApi.parseImport(file, 'Chassis');

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/admin/import/parse');
    expect(call[1].body).toBeInstanceOf(FormData);
    // No explicit Content-Type: the browser must set the multipart boundary.
    expect(call[1].headers).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w frontend -- admin/api`
Expected: FAIL — `frontend/src/admin/api.ts` doesn't exist.

- [ ] **Step 4: Implement**

Create `frontend/src/admin/api.ts`:

```ts
import { request, type User } from '../auth/api';

export type AdminUser = User;

export type AdminAttempt = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
};

/**
 * Opaque from the frontend's point of view — it is parsed on the server and
 * handed back unmodified to /confirm. Typed as unknown rather than mirrored
 * field-for-field so this file does not have to track the backend's
 * ParsedSubject shape.
 */
export type ParsedSubjectPayload = unknown;

export type ImportSummary = { courses: number; questions: number };

export const adminApi = {
  listUsers: () => request<{ users: AdminUser[] }>('/admin/users'),

  setRole: (id: string, role: 'user' | 'admin') =>
    request<{ user: AdminUser }>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  getUserAttempts: (id: string) =>
    request<{ attempts: AdminAttempt[] }>(`/admin/users/${id}/attempts`),

  parseImport: (file: File, subjectTitle: string) => {
    const form = new FormData();
    form.append('pdf', file);
    form.append('subjectTitle', subjectTitle);
    // No Content-Type header: letting fetch set it lets the browser attach
    // the multipart boundary, which request()'s default JSON header would
    // otherwise clobber.
    return request<{ subject: ParsedSubjectPayload; summary: ImportSummary } | { errors: string[] }>(
      '/admin/import/parse',
      { method: 'POST', body: form, headers: {} },
    );
  },

  confirmImport: (subject: ParsedSubjectPayload) =>
    request<ImportSummary>('/admin/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ subject }),
    }),
};
```

This requires `request()` to not force a `Content-Type: application/json` header when
the caller explicitly passes `headers: {}`. Check `auth/api.ts`'s current merge:
`headers: { 'Content-Type': 'application/json', ...init?.headers }` — passing
`headers: {}` leaves `Content-Type` at `application/json`, which is wrong for
`FormData`. Fix `request()` in `frontend/src/auth/api.ts` so a caller can opt out:

```ts
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;

  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData
      ? init?.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : res.statusText;
    throw new ApiError(message, res.status);
  }

  return body as T;
}
```

And simplify `adminApi.parseImport` to drop the now-unnecessary `headers: {}`:

```ts
  parseImport: (file: File, subjectTitle: string) => {
    const form = new FormData();
    form.append('pdf', file);
    form.append('subjectTitle', subjectTitle);
    return request<{ subject: ParsedSubjectPayload; summary: ImportSummary } | { errors: string[] }>(
      '/admin/import/parse',
      { method: 'POST', body: form },
    );
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w frontend -- admin/api`
Expected: PASS, all three cases. Also re-run the existing auth api tests if any exist
for `request()`:

Run: `npm run test -w frontend -- auth/api`
Expected: PASS (no existing test file for `auth/api.ts` was found during planning; if
one exists, confirm it still passes).

- [ ] **Step 6: Typecheck and full frontend test run**

Run: `npm run typecheck && npm run test -w frontend`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/admin/api.ts frontend/src/admin/api.test.ts
git commit -m "feat(web): add admin API client"
```

---

### Task 8: `RequireAdmin` route guard and sidebar entry

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/SidebarNav.tsx`
- Modify: `frontend/src/App.css`
- Test: `frontend/src/router.test.tsx` (extend)
- Test: `frontend/src/shell/SidebarNav.test.tsx` (create)

**Interfaces:**
- Consumes: `useAuth()` (existing), `User.role` (Task 7).
- Produces: a `RequireAdmin` wrapper in `router.tsx` used by Tasks 9-10's routes; an
  "Admin" nav section in `SidebarNav` visible only for `role === 'admin'`.

- [ ] **Step 1: Update the shared mock user fixture**

`/admin/users` isn't a route yet (it's added in Task 9), so a route-level 404 test
belongs there, once there's a real route to gate. This task instead tests the
`RequireAdmin` guard component directly, in isolation from the router.

First, update `router.test.tsx`'s existing `beforeEach` default mock user to include
`role: 'user'` — it currently omits the field, which becomes a type error once
`User.role` is required:

```ts
beforeEach(() => {
  useAuth.mockReturnValue({
    user: { id: 'u1', email: 'a@b.com', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
});
```

Run: `npm run test -w frontend -- router.test`
Expected: PASS — this is a type/fixture fix, not new behavior, so the existing suite
should stay green.

- [ ] **Step 2: Write the failing guard test**

Create `frontend/src/router.admin-guard.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RequireAdmin } from './router';

const useAuth = vi.fn();
vi.mock('./auth/useAuth', () => ({ useAuth: () => useAuth() }));

function renderGuard() {
  return render(
    <MemoryRouter>
      <RequireAdmin>
        <div>admin content</div>
      </RequireAdmin>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  test('renders children for an admin', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'admin' }, loading: false });
    renderGuard();
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  test('renders the 404 page for a signed-in non-admin', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com', role: 'user' }, loading: false });
    renderGuard();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  test('renders the 404 page when signed out', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderGuard();
    expect(screen.getByText('404')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w frontend -- router.admin-guard`
Expected: FAIL — `RequireAdmin` is not exported from `router.tsx`.

- [ ] **Step 4: Implement `RequireAdmin`**

Edit `frontend/src/router.tsx`, add alongside `RequireAuth`:

```tsx
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
```

This requires `NotFoundPage` to already be imported in `router.tsx` (it is, for the
catch-all route).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w frontend -- router.admin-guard`
Expected: PASS, all three cases.

- [ ] **Step 6: Add the sidebar entry**

Edit `frontend/src/shell/SidebarNav.tsx`. Add a `CogIcon`-based "Admin" link (reusing
the existing `CogIcon` from `./icons`, already used for Drive Train/Engine, which is
fine to reuse here since it's a generic gear glyph, not subject-specific branding).
Change the `SidebarNav` signature to accept the user's role and render a trailing
section:

```tsx
import { useId } from 'react';
import { NavLink, useLocation } from 'react-router';
import { BookIcon, ChevronRightIcon, CogIcon, SubjectIcon } from './icons';
import { hasPassed } from '../quiz/passed';
import type { SubjectNavState } from './useSubjectNav';

// ... SubjectGroup unchanged ...

export function SidebarNav({
  nav,
  userEmail,
  userRole,
  onNavigate,
}: {
  nav: SubjectNavState;
  userEmail?: string;
  userRole?: 'user' | 'admin';
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item current' : 'nav-item';

  return (
    <nav className="sidebar-nav" aria-label="Subjects">
      <ul className="nav-list">
        <li>
          <NavLink to="/subjects" onClick={onNavigate} end className={itemClass}>
            <BookIcon className="nav-icon" />
            <span className="nav-label">All subjects</span>
          </NavLink>
        </li>

        {nav.error && (
          <li role="alert" className="nav-panel-note">
            {nav.error}
          </li>
        )}

        {!nav.error && !nav.loading && nav.subjects.length === 0 && (
          <li className="nav-panel-note">No subjects imported yet</li>
        )}

        {nav.subjects.map((s) => (
          <SubjectGroup
            key={s.id}
            slug={s.slug}
            title={s.title}
            courseCount={s.courseCount}
            nav={nav}
            isCurrent={pathname.startsWith(`/subjects/${s.slug}`)}
            onNavigate={onNavigate}
          />
        ))}

        {userRole === 'admin' && (
          <>
            <li className="nav-divider" role="separator" />
            <li>
              <NavLink to="/admin/users" onClick={onNavigate} className={itemClass}>
                <CogIcon className="nav-icon" />
                <span className="nav-label">Admin · Users</span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/admin/import" onClick={onNavigate} className={itemClass}>
                <CogIcon className="nav-icon" />
                <span className="nav-label">Admin · Import</span>
              </NavLink>
            </li>
          </>
        )}
      </ul>

      {userEmail && (
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">
            {userEmail.charAt(0).toUpperCase()}
          </span>
          <span className="sidebar-footer-email">{userEmail}</span>
        </div>
      )}
    </nav>
  );
}
```

Edit `frontend/src/shell/AppShell.tsx` to pass the new prop:

```tsx
          <SidebarNav nav={nav} userEmail={user?.email} userRole={user?.role} onNavigate={close} />
```

Add to `frontend/src/App.css`, near the other `.nav-*` rules:

```css
.nav-divider { height: 1px; margin: 0.6rem 0.75rem; background: var(--border); list-style: none; }
```

- [ ] **Step 7: Write the sidebar test**

Create `frontend/src/shell/SidebarNav.test.tsx`:

```tsx
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SidebarNav } from './SidebarNav';
import type { SubjectNavState } from './useSubjectNav';

const emptyNav: SubjectNavState = {
  subjects: [],
  loading: false,
  error: null,
  isOpen: () => false,
  courses: {},
  toggle: () => {},
};

describe('SidebarNav', () => {
  test('shows no Admin section for a plain user', () => {
    render(
      <MemoryRouter>
        <SidebarNav nav={emptyNav} userEmail="a@b.com" userRole="user" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Admin · Users')).not.toBeInTheDocument();
  });

  test('shows the Admin section for an admin', () => {
    render(
      <MemoryRouter>
        <SidebarNav nav={emptyNav} userEmail="a@b.com" userRole="admin" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Admin · Users')).toBeInTheDocument();
    expect(screen.getByText('Admin · Import')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -w frontend -- SidebarNav`
Expected: PASS, both cases.

- [ ] **Step 9: Typecheck and full frontend test run**

Run: `npm run typecheck && npm run test -w frontend`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/router.tsx frontend/src/router.admin-guard.test.tsx frontend/src/shell/SidebarNav.tsx frontend/src/shell/AppShell.tsx frontend/src/App.css frontend/src/shell/SidebarNav.test.tsx frontend/src/router.test.tsx
git commit -m "feat(web): add RequireAdmin guard and sidebar admin section"
```

---

### Task 9: `AdminUsersPage`

**Files:**
- Create: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/App.css`
- Test: `frontend/src/pages/admin/AdminUsersPage.test.tsx`
- Test: `frontend/src/router.test.tsx` (extend, the admin-route-gating case deferred
  from Task 8)

**Interfaces:**
- Consumes: `adminApi.listUsers`, `adminApi.setRole`, `adminApi.deleteUser`,
  `adminApi.getUserAttempts` (Task 7); `useAuth()` for the current user's id (to
  disable self-demote/self-delete controls).
- Produces: the `/admin/users` route and page. No other task depends on this page's
  internals.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AdminUsersPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminUsersPage } from './AdminUsersPage';

const listUsers = vi.fn();
const setRole = vi.fn();
const deleteUser = vi.fn();
const getUserAttempts = vi.fn();
const useAuth = vi.fn();

vi.mock('../../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../../admin/api', () => ({
  adminApi: { listUsers, setRole, deleteUser, getUserAttempts },
}));

beforeEach(() => {
  useAuth.mockReturnValue({ user: { id: 'me', email: 'admin@example.com', role: 'admin' } });
  listUsers.mockResolvedValue({
    users: [
      { id: 'me', email: 'admin@example.com', role: 'admin', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'u2', email: 'student@example.com', role: 'user', createdAt: '2026-11-02T00:00:00Z' },
    ],
  });
  getUserAttempts.mockResolvedValue({ attempts: [] });
  setRole.mockResolvedValue({ user: { id: 'u2', email: 'student@example.com', role: 'admin' } });
  deleteUser.mockResolvedValue(undefined);
});

describe('AdminUsersPage', () => {
  test('lists every user with their role', async () => {
    render(<AdminUsersPage />);
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
  });

  test('disables promote/demote and delete for the signed-in admin\'s own row', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');
    const ownRow = screen.getByText('admin@example.com').closest('tr')!;
    expect(within(ownRow).getByRole('button', { name: /make user/i })).toBeDisabled();
    expect(within(ownRow).getByRole('button', { name: /delete/i })).toBeDisabled();
  });

  test('promoting a user calls setRole and reflects the new role', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /make admin/i }));

    await waitFor(() => expect(setRole).toHaveBeenCalledWith('u2', 'admin'));
  });

  test('deleting a user calls deleteUser and removes the row', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;
    fireEvent.click(within(studentRow).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u2'));
    await waitFor(() =>
      expect(screen.queryByText('student@example.com')).not.toBeInTheDocument(),
    );
  });
});
```

This test uses `within`, which must be imported from `@testing-library/react`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w frontend -- AdminUsersPage`
Expected: FAIL — the page component doesn't exist.

- [ ] **Step 3: Implement**

Create `frontend/src/pages/admin/AdminUsersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminUser } from '../../admin/api';
import { useAuth } from '../../auth/useAuth';

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div className="admin-page">
      <h1>Users</h1>

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w frontend -- AdminUsersPage`
Expected: PASS, all four cases.

- [ ] **Step 5: Wire the route**

Edit `frontend/src/router.tsx`, add the import and route inside the `RequireAuth +
AppShell` block:

```tsx
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
```

```tsx
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
```

- [ ] **Step 6: Complete the deferred router test from Task 8**

Append to `frontend/src/router.test.tsx`:

```ts
  test('a non-admin hitting /admin/users sees the 404 page, not the users table', () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'user', createdAt: '2026-11-02T12:00:00.000Z' },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    at('/admin/users');

    expect(screen.getByText('404')).toBeInTheDocument();
  });
```

(This will make real network calls from `AdminUsersPage` impossible to reach, since
`RequireAdmin` renders `NotFoundPage` before the page mounts — no additional mocking of
`adminApi` is needed for this test.)

- [ ] **Step 7: Add minimal styling**

Add to `frontend/src/App.css`:

```css
.admin-page { max-width: 56rem; margin: 2rem auto; padding: 0 1.25rem; text-align: left; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.admin-table th, .admin-table td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
.admin-actions { display: flex; gap: 0.5rem; }
```

- [ ] **Step 8: Run full frontend test suite and typecheck**

Run: `npm run typecheck && npm run test -w frontend`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx frontend/src/router.tsx frontend/src/router.test.tsx frontend/src/App.css
git commit -m "feat(web): add AdminUsersPage"
```

---

### Task 10: `AdminImportPage`

**Files:**
- Create: `frontend/src/pages/admin/AdminImportPage.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/App.css`
- Test: `frontend/src/pages/admin/AdminImportPage.test.tsx`

**Interfaces:**
- Consumes: `adminApi.parseImport`, `adminApi.confirmImport` (Task 7).
- Produces: the `/admin/import` route and page. Terminal task — nothing depends on it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AdminImportPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminImportPage } from './AdminImportPage';

const parseImport = vi.fn();
const confirmImport = vi.fn();

vi.mock('../../admin/api', () => ({
  adminApi: { parseImport: (...a: unknown[]) => parseImport(...a), confirmImport: (...a: unknown[]) => confirmImport(...a) },
}));

function selectFile() {
  const file = new File(['pdf-bytes'], 'chassis.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText(/pdf file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  parseImport.mockReset();
  confirmImport.mockReset();
});

describe('AdminImportPage', () => {
  test('shows a summary and a Confirm button after a successful parse', async () => {
    parseImport.mockResolvedValue({ subject: { slug: 'chassis' }, summary: { courses: 11, questions: 110 } });
    render(<AdminImportPage />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Chassis' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText(/11 courses, 110 questions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeInTheDocument();
  });

  test('shows parser errors and no Confirm button on a bad pack', async () => {
    parseImport.mockResolvedValue({ errors: ['Course 3: cover page declared 10 questions, found 9.'] });
    render(<AdminImportPage />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Bad' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText(/cover page declared 10 questions/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm import/i })).not.toBeInTheDocument();
  });

  test('clicking Confirm calls confirmImport with the parsed subject', async () => {
    parseImport.mockResolvedValue({ subject: { slug: 'chassis' }, summary: { courses: 11, questions: 110 } });
    confirmImport.mockResolvedValue({ courses: 11, questions: 110 });
    render(<AdminImportPage />);

    fireEvent.change(screen.getByLabelText(/subject title/i), { target: { value: 'Chassis' } });
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(confirmImport).toHaveBeenCalledWith({ slug: 'chassis' }));
    expect(await screen.findByText(/imported: 11 courses, 110 questions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w frontend -- AdminImportPage`
Expected: FAIL — the page component doesn't exist.

- [ ] **Step 3: Implement**

Create `frontend/src/pages/admin/AdminImportPage.tsx`:

```tsx
import { useId, useState } from 'react';
import { adminApi, type ImportSummary, type ParsedSubjectPayload } from '../../admin/api';

type ParseResult =
  | { kind: 'summary'; summary: ImportSummary; subject: ParsedSubjectPayload }
  | { kind: 'errors'; errors: string[] };

export function AdminImportPage() {
  const titleId = useId();
  const fileId = useId();
  const [subjectTitle, setSubjectTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = async () => {
    if (!file || !subjectTitle.trim()) return;
    setBusy(true);
    setError(null);
    setImported(null);
    try {
      const res = await adminApi.parseImport(file, subjectTitle);
      if ('errors' in res) {
        setResult({ kind: 'errors', errors: res.errors });
      } else {
        setResult({ kind: 'summary', summary: res.summary, subject: res.subject });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!result || result.kind !== 'summary') return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.confirmImport(result.subject);
      setImported(res);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <h1>Import quiz content</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      <div className="import-form">
        <label htmlFor={titleId}>Subject title</label>
        <input
          id={titleId}
          type="text"
          value={subjectTitle}
          onChange={(e) => setSubjectTitle(e.target.value)}
        />

        <label htmlFor={fileId}>PDF file</label>
        <input
          id={fileId}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button type="button" disabled={busy || !file || !subjectTitle.trim()} onClick={() => void parse()}>
          Parse
        </button>
      </div>

      {result?.kind === 'errors' && (
        <div className="import-errors" role="alert">
          <h2>Parse errors</h2>
          <ul>
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.kind === 'summary' && (
        <div className="import-preview">
          <p>
            Parsed {result.summary.courses} courses, {result.summary.questions} questions.
          </p>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            Confirm import
          </button>
        </div>
      )}

      {imported && (
        <p className="import-success">
          Imported: {imported.courses} courses, {imported.questions} questions.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w frontend -- AdminImportPage`
Expected: PASS, all three cases.

- [ ] **Step 5: Wire the route**

Edit `frontend/src/router.tsx`:

```tsx
import { AdminImportPage } from './pages/admin/AdminImportPage';
```

```tsx
          <Route
            path="/admin/import"
            element={
              <RequireAdmin>
                <AdminImportPage />
              </RequireAdmin>
            }
          />
```

- [ ] **Step 6: Add minimal styling**

Add to `frontend/src/App.css`:

```css
.import-form { display: flex; flex-direction: column; gap: 0.5rem; max-width: 24rem; margin-top: 1rem; }
.import-errors, .import-preview { margin-top: 1.5rem; }
.import-errors { color: var(--warning); }
.import-success { color: var(--success); margin-top: 1rem; }
```

- [ ] **Step 7: Full typecheck, full test run, both workspaces**

Run: `npm run typecheck && npm run test`
Expected: clean across backend and frontend.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/AdminImportPage.tsx frontend/src/pages/admin/AdminImportPage.test.tsx frontend/src/router.tsx frontend/src/App.css
git commit -m "feat(web): add AdminImportPage"
```

---

## Manual verification (after all tasks)

1. `npm run db:up && npm run db:push`
2. Register a user through the normal sign-in screen, then promote it to admin
   directly in Postgres: `update users set role = 'admin' where email = '...';`
3. `npm run dev`, sign in as that user, confirm the "Admin" sidebar section appears and
   a second (non-promoted) account does not see it.
4. On `/admin/users`, promote and demote a different account, delete one, confirm the
   list updates and self-row actions are disabled.
5. On `/admin/import`, upload one of the real subject PDFs from
   `~/Documents/LIAH-classes/quizzes/`, confirm the preview counts match the pack,
   click Confirm, and confirm the subject appears in the sidebar's subject list.
6. Re-upload the same PDF and confirm it does not duplicate the subject (upsert by
   slug).

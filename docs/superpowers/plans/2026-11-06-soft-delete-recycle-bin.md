# Soft delete for users & courses + admin recycle bin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `isActive`/`deletedAt` to `users` and `courses`, turn the existing hard-delete-user action into a soft delete, add a course soft-delete (there is no course delete today), filter every active-resource fetch to `isActive = true`, and give admins a Recycle Bin page to restore either kind.

**Architecture:** Two parallel vertical slices (users, courses) sharing one pattern: a DB column pair (`isActive`, `deletedAt`), a model layer that filters active rows and offers delete/restore, a thin controller/route layer, and an admin page. Login and session lookup gain an `isActive` check so a soft-deleted user is immediately locked out. Catalog browsing filters inactive courses; a user's own attempt history does not.

**Tech Stack:** Express + Drizzle ORM (Postgres) on the backend, React + Vite + Vitest on the frontend, `node:test` for backend tests.

## Global Constraints

- No hard/permanent-delete action is introduced anywhere in this change — only soft delete + restore.
- The existing self-delete guard (an admin can't delete their own account) must keep working unchanged.
- A soft-deleted course disappears from the active catalog (`GET /subjects`, `GET /courses`) but **must still appear** in a learner's own `GET /me/progress` history.
- A soft-deleted user must be blocked from logging in **and** have any existing session invalidated immediately.
- `subjects` table is out of scope — no `isActive` there.
- Every schema change to `backend/src/models/schema.ts` must be followed by `npm run db:generate -w backend` (commit the generated SQL) and, before running backend tests, `cd backend && npm run db:push:test` to apply it to the local test DB — CI fails the PR if generated SQL is missing.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/models/schema.ts` | Modify: add `isActive`/`deletedAt` to `users`, `courses` |
| `backend/drizzle/*.sql` | New migration (generated, not hand-written) |
| `backend/src/models/user.model.ts` | Modify: login lookup excludes inactive users |
| `backend/src/models/session.model.ts` | Modify: session lookup excludes inactive users |
| `backend/src/models/admin-user.model.ts` | Modify: soft delete/restore/list-deleted for users |
| `backend/src/controllers/admin-users.controller.ts` | Modify: add deleted-list/restore handlers |
| `backend/src/routes/admin.routes.ts` | Modify: register new user + course admin routes |
| `backend/src/models/catalog.model.ts` | Modify: active-catalog queries filter `isActive` |
| `backend/src/models/admin-course.model.ts` | New: course list/delete/list-deleted/restore |
| `backend/src/controllers/admin-courses.controller.ts` | New: course admin HTTP handlers |
| `frontend/src/admin/api.ts` | Modify: `AdminUser` gets its own shape + new fields; new `AdminCourse` type; new API functions |
| `frontend/src/pages/admin/AdminCoursesPage.tsx` | New: list active courses, delete action |
| `frontend/src/shell/icons.tsx` | Modify: add `RestoreIcon` |
| `frontend/src/pages/admin/RecycleBinPage.tsx` | New: tabbed Deleted Users / Deleted Courses with restore |
| `frontend/src/shell/AccountMenu.tsx` | Modify: add "Admin · Courses" and "Admin · Recycle Bin" links |
| `frontend/src/router.tsx` | Modify: register the two new admin routes |
| `frontend/src/App.css` | Modify: add `.recycle-bin-tab*` styles |

---

### Task 1: Schema migration — `isActive`/`deletedAt` on users & courses

**Files:**
- Modify: `backend/src/models/schema.ts:14-29` (users table), `backend/src/models/schema.ts:57-72` (courses table)
- Generated: `backend/drizzle/0001_*.sql` (via `db:generate`, not hand-written)

**Interfaces:**
- Produces: `users.isActive: boolean`, `users.deletedAt: Date | null`, `courses.isActive: boolean`, `courses.deletedAt: Date | null` — every later task's Drizzle queries reference these two column names.

- [ ] **Step 1: Add the columns to `users`**

In `backend/src/models/schema.ts`, change the `users` table definition from:

```ts
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

to:

```ts
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete flag. false blocks login, kills existing sessions, and hides
   *  the user from every admin listing. See deletedAt. */
  isActive: boolean('is_active').notNull().default(true),
  /** Set together with isActive — non-null exactly when isActive is false. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

- [ ] **Step 2: Add the columns to `courses`**

Change the `courses` table definition from:

```ts
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
  },
  (t) => [unique('courses_subject_position_unique').on(t.subjectId, t.position)],
);
```

to:

```ts
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
    /** Soft-delete flag. false hides the course from the active catalog
     *  (listSubjects/listCoursesBySubject); a learner's own attempt history
     *  is unaffected. See deletedAt. */
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [unique('courses_subject_position_unique').on(t.subjectId, t.position)],
);
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate -w backend`
Expected: a new file appears under `backend/drizzle/`, e.g. `0001_<name>.sql`, containing `ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;` and the matching statements for `deleted_at`, repeated for `courses`.

- [ ] **Step 4: Apply the migration to the local test database**

Run: `cd backend && npm run db:push:test`
Expected: exits 0 with a summary of the two `ALTER TABLE` changes applied.

- [ ] **Step 5: Confirm the existing suite still passes**

Run: `npm run test -w backend`
Expected: all existing tests pass unchanged — the new columns default to `true`/`null` and nothing reads them yet.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/schema.ts backend/drizzle/
git commit -m "feat(db): add isActive/deletedAt to users and courses"
```

---

### Task 2: Block login and existing sessions for a soft-deleted user

**Files:**
- Modify: `backend/src/models/user.model.ts:78-88` (`findUserByUsernameWithHash`)
- Modify: `backend/src/models/session.model.ts:17-31` (`findUserBySessionId`)
- Test: `backend/src/controllers/auth.controller.test.ts`

**Interfaces:**
- Consumes: `users.isActive` (Task 1).
- Produces: no new exports — same function signatures, now filtering on `isActive`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/auth.controller.test.ts`, after the existing imports:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../models/schema.ts';
```

Add these two tests at the end of the file:

```ts
test('POST /api/v1/auth/login rejects an inactive user', async () => {
  const { username, userId } = await registerTestUser(baseUrl, 'Inactive');
  await db.update(users).set({ isActive: false, deletedAt: new Date() }).where(eq(users.id, userId));

  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/v1/auth/me 401s once the session owner is deactivated', async () => {
  const { cookie, userId } = await registerTestUser(baseUrl, 'Deactivated');

  const before = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(before.status, 200);

  await db.update(users).set({ isActive: false, deletedAt: new Date() }).where(eq(users.id, userId));

  const after = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(after.status, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern="rejects an inactive user|401s once the session owner"`
Expected: both FAIL — login still succeeds (401 expected, not returned) and `/auth/me` still returns 200 after deactivation.

- [ ] **Step 3: Filter the login lookup**

In `backend/src/models/user.model.ts`, change `findUserByUsernameWithHash` from:

```ts
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
```

to:

```ts
export async function findUserByUsernameWithHash(
  username: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.username, username), eq(users.isActive, true)))
    .limit(1);

  return user ?? null;
}
```

(`and` is already imported at the top of this file.)

- [ ] **Step 4: Filter the session lookup**

In `backend/src/models/session.model.ts`, change `findUserBySessionId` from:

```ts
export async function findUserBySessionId(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}
```

to:

```ts
export async function findUserBySessionId(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, id),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w backend`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/models/session.model.ts backend/src/controllers/auth.controller.test.ts
git commit -m "feat(auth): block login and existing sessions for a deactivated user"
```

---

### Task 3: Soft delete / restore for users (admin)

**Files:**
- Modify: `backend/src/models/admin-user.model.ts` (full rewrite below)
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `deleteSessionsForUser(userId: string): Promise<void>` from `backend/src/models/session.model.ts` (already exists, unchanged).
- Produces: `listDeletedUsers(page: number): Promise<PublicUser[]>`, `countDeletedUsers(): Promise<number>`, `restoreUserById(id: string): Promise<PublicUser | null>` — used by the new controller handlers below, and by nothing else in this plan.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/admin-users.controller.test.ts`, at the end of the file:

```ts
test('DELETE soft-deletes a user, who appears in the recycle bin and can be restored', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Student');

  const del = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(del.status, 204);

  const deletedList = await fetch(`${baseUrl}/api/v1/admin/users/deleted`, { headers: { cookie } });
  assert.equal(deletedList.status, 200);
  const deletedBody = (await deletedList.json()) as { items: Array<{ username: string }> };
  assert.equal(deletedBody.items.some((u) => u.username === username), true);

  const restore = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(restore.status, 200);

  const activeList = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const activeBody = (await activeList.json()) as { items: Array<{ username: string }> };
  assert.equal(activeBody.items.some((u) => u.username === username), true);
});

test('DELETE 404s when the user is already deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, { method: 'DELETE', headers: { cookie } });
  const second = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(second.status, 404);
});

test('POST restore 404s for a user that is not deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});

test('a soft-deleted user is signed out immediately', async () => {
  const { cookie: adminCookie } = await makeAdmin('Admin');
  const { cookie: studentCookie, userId } = await registerTestUser(baseUrl, 'Student');

  const before = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(before.status, 200);

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie: adminCookie },
  });

  const after = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(after.status, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern="recycle bin|already deleted|not deleted|signed out immediately"`
Expected: FAIL — `GET /admin/users/deleted` and `POST /admin/users/:id/restore` don't exist yet (404 from the router's catch-all, not the handlers), and re-deleting still returns 204.

- [ ] **Step 3: Rewrite the model**

Replace the full contents of `backend/src/models/admin-user.model.ts` with:

```ts
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';
import { deleteSessionsForUser } from './session.model.ts';
import { users } from './schema.ts';
import type { PublicUser } from './user.model.ts';

const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
  isActive: users.isActive,
  deletedAt: users.deletedAt,
};

export async function listUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.createdAt)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.isActive, true));
  return Number(row?.value ?? 0);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const [row] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
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

/**
 * Soft delete: marks the user inactive and kills every one of their
 * sessions. Only rows that are currently active can be deleted, so deleting
 * an already-deleted user 404s instead of silently no-op-ing. True if a row
 * was deactivated.
 */
export async function deleteUserById(id: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.isActive, true)))
    .returning({ id: users.id });

  if (result.length === 0) return false;
  await deleteSessionsForUser(id);
  return true;
}

export async function listDeletedUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .where(eq(users.isActive, false))
    .orderBy(desc(users.deletedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countDeletedUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.isActive, false));
  return Number(row?.value ?? 0);
}

/** Restore: only rows that are currently inactive can be restored. */
export async function restoreUserById(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .update(users)
    .set({ isActive: true, deletedAt: null })
    .where(and(eq(users.id, id), eq(users.isActive, false)))
    .returning(publicColumns);
  return row ?? null;
}
```

- [ ] **Step 4: Add the controller handlers**

In `backend/src/controllers/admin-users.controller.ts`, change the import from `../models/admin-user.model.ts` from:

```ts
import {
  countUsers,
  deleteUserById,
  findUserById,
  listUsers,
  setUserRole,
} from '../models/admin-user.model.ts';
```

to:

```ts
import {
  countDeletedUsers,
  countUsers,
  deleteUserById,
  findUserById,
  listDeletedUsers,
  listUsers,
  restoreUserById,
  setUserRole,
} from '../models/admin-user.model.ts';
```

Add these two handlers after `getUsers`:

```ts
export async function getDeletedUsers(req: Request, res: Response): Promise<void> {
  const page = parsePage(req);
  const [items, total] = await Promise.all([listDeletedUsers(page), countDeletedUsers()]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
}

export async function restoreUserHandler(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const user = await restoreUserById(id);
  if (!user) {
    res.status(404).json({ error: 'Deleted user not found' });
    return;
  }
  res.json({ user });
}
```

- [ ] **Step 5: Register the routes**

In `backend/src/routes/admin.routes.ts`, change:

```ts
adminRouter.get('/users', adminUsers.getUsers);
adminRouter.post('/users', adminUsers.createUserHandler);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
```

to:

```ts
adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/deleted', adminUsers.getDeletedUsers);
adminRouter.post('/users', adminUsers.createUserHandler);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
adminRouter.post('/users/:id/restore', adminUsers.restoreUserHandler);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w backend`
Expected: PASS, including all four new tests and the pre-existing `'DELETE removes a user'` test (still true: the row no longer appears in `listUsers`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/admin-user.model.ts backend/src/controllers/admin-users.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(admin): soft-delete and restore users"
```

---

### Task 4: Filter the active catalog by `isActive`

**Files:**
- Modify: `backend/src/models/catalog.model.ts`
- Test: `backend/src/controllers/catalog.controller.test.ts`, `backend/src/controllers/progress.test.ts`

**Interfaces:**
- Consumes: `courses.isActive` (Task 1).
- Produces: no signature changes to `listSubjects`/`listCoursesBySubject`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/catalog.controller.test.ts`, after the existing imports:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses } from '../models/schema.ts';
```

Add at the end of the file:

```ts
test('GET /api/v1/courses excludes a soft-deleted course', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const body = (await res.json()) as { courses: Array<{ slug: string }> };
  assert.equal(body.courses.length, 10);
  assert.equal(body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'), false);

  // Reset so later tests in this file see the full seeded set again.
  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});

test('GET /api/v1/subjects excludes a soft-deleted course from the count', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/subjects`);
  const body = (await res.json()) as { subjects: Array<{ courseCount: number }> };
  assert.equal(body.subjects[0]?.courseCount, 10);

  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});
```

Add to `backend/src/controllers/progress.test.ts`, after the existing imports:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses } from '../models/schema.ts';
```

Add at the end of the file:

```ts
test('a soft-deleted course still appears in progress history', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'historic');
  await takeQuiz(cookie, SLUG_1, course1, 9);

  const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, SLUG_1));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: Array<{ courseSlug: string }> };
  assert.equal(body.courses.some((c) => c.courseSlug === SLUG_1), true);

  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern="excludes a soft-deleted|still appears in progress"`
Expected: FAIL — the deleted course still shows up in `/courses` and `/subjects`' count (`courseCount` would be 11, not 10).

- [ ] **Step 3: Filter `listSubjects`**

In `backend/src/models/catalog.model.ts`, change:

```ts
    .from(subjects)
    .leftJoin(courses, eq(courses.subjectId, subjects.id))
    .groupBy(subjects.id, subjects.slug, subjects.title)
```

to:

```ts
    .from(subjects)
    .leftJoin(courses, and(eq(courses.subjectId, subjects.id), eq(courses.isActive, true)))
    .groupBy(subjects.id, subjects.slug, subjects.title)
```

(`and` is already imported at the top of this file.)

- [ ] **Step 4: Filter `listCoursesBySubject`**

Change:

```ts
    .where(eq(courses.subjectId, subject.id))
    .groupBy(
```

to:

```ts
    .where(and(eq(courses.subjectId, subject.id), eq(courses.isActive, true)))
    .groupBy(
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/catalog.model.ts backend/src/controllers/catalog.controller.test.ts backend/src/controllers/progress.test.ts
git commit -m "feat(catalog): hide soft-deleted courses from the active catalog"
```

---

### Task 5: Soft delete / restore for courses (admin)

**Files:**
- Create: `backend/src/models/admin-course.model.ts`
- Create: `backend/src/controllers/admin-courses.controller.ts`
- Modify: `backend/src/routes/admin.routes.ts`
- Test: Create `backend/src/controllers/admin-courses.controller.test.ts`

**Interfaces:**
- Consumes: `courses.isActive`/`deletedAt` (Task 1), the `chassis` quiz-pack fixture seeded via `seedSubject` (same pattern as `catalog.controller.test.ts`).
- Produces: `AdminCourse` type `{ id: string; slug: string; title: string; position: number; passScore: number; questionCount: number; subjectSlug: string; subjectTitle: string; isActive: boolean; deletedAt: Date | null }`, and `listCourses(): Promise<AdminCourse[]>`, `deleteCourseById(id: string): Promise<boolean>`, `listDeletedCourses(): Promise<AdminCourse[]>`, `restoreCourseById(id: string): Promise<AdminCourse | null>` — consumed by the controller in this task, and mirrored by the frontend `AdminCourse` type in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/admin-courses.controller.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { courses } from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

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
  await seedSubject(subject);
});

async function makeAdmin(label: string) {
  const { cookie, userId } = await registerTestUser(baseUrl, label);
  await setUserRole(userId, 'admin');
  return { cookie, userId };
}

async function courseId(slug: string): Promise<string> {
  const [row] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, slug));
  return row!.id;
}

test('GET /api/v1/admin/courses lists courses with their subject', async () => {
  const { cookie } = await makeAdmin('Admin');
  const res = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ slug: string; subjectSlug: string }> };
  assert.equal(body.items.length, 11);
  assert.equal(body.items.some((c) => c.slug === SLUG && c.subjectSlug === 'chassis'), true);
});

test('GET /api/v1/admin/courses 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('DELETE soft-deletes a course, hiding it from the catalog and admin list', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  const res = await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  const body = (await list.json()) as { items: Array<{ slug: string }> };
  assert.equal(body.items.some((c) => c.slug === SLUG), false);

  const catalog = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const catalogBody = (await catalog.json()) as { courses: Array<{ slug: string }> };
  assert.equal(catalogBody.courses.some((c) => c.slug === SLUG), false);
});

test('DELETE 404s when the course is already deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, { method: 'DELETE', headers: { cookie } });
  const second = await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(second.status, 404);
});

test('GET /api/v1/admin/courses/deleted lists a soft-deleted course, and restore brings it back', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);
  await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, { method: 'DELETE', headers: { cookie } });

  const deletedList = await fetch(`${baseUrl}/api/v1/admin/courses/deleted`, { headers: { cookie } });
  const deletedBody = (await deletedList.json()) as { items: Array<{ slug: string }> };
  assert.equal(deletedBody.items.some((c) => c.slug === SLUG), true);

  const restore = await fetch(`${baseUrl}/api/v1/admin/courses/${id}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(restore.status, 200);

  const catalog = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const catalogBody = (await catalog.json()) as { courses: Array<{ slug: string }> };
  assert.equal(catalogBody.courses.some((c) => c.slug === SLUG), true);
});

test('POST restore 404s for a course that is not deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  const res = await fetch(`${baseUrl}/api/v1/admin/courses/${id}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern="admin/courses"`
Expected: FAIL with 404s for every request — `/admin/courses*` routes don't exist yet.

- [ ] **Step 3: Create the model**

Create `backend/src/models/admin-course.model.ts`:

```ts
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses, subjects } from './schema.ts';

export type AdminCourse = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  subjectSlug: string;
  subjectTitle: string;
  isActive: boolean;
  deletedAt: Date | null;
};

const columns = {
  id: courses.id,
  slug: courses.slug,
  title: courses.title,
  position: courses.position,
  passScore: courses.passScore,
  questionCount: courses.questionCount,
  subjectSlug: subjects.slug,
  subjectTitle: subjects.title,
  isActive: courses.isActive,
  deletedAt: courses.deletedAt,
};

export async function listCourses(): Promise<AdminCourse[]> {
  return db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.isActive, true))
    .orderBy(asc(subjects.title), asc(courses.position));
}

/** Soft delete: only rows that are currently active can be deleted, so
 *  deleting an already-deleted course 404s instead of silently no-op-ing. */
export async function deleteCourseById(id: string): Promise<boolean> {
  const result = await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(courses.id, id), eq(courses.isActive, true)))
    .returning({ id: courses.id });
  return result.length > 0;
}

export async function listDeletedCourses(): Promise<AdminCourse[]> {
  return db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.isActive, false))
    .orderBy(desc(courses.deletedAt));
}

/** Restore: only rows that are currently inactive can be restored. */
export async function restoreCourseById(id: string): Promise<AdminCourse | null> {
  const [updated] = await db
    .update(courses)
    .set({ isActive: true, deletedAt: null })
    .where(and(eq(courses.id, id), eq(courses.isActive, false)))
    .returning({ id: courses.id });
  if (!updated) return null;

  const [row] = await db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.id, id));
  return row ?? null;
}
```

- [ ] **Step 4: Create the controller**

Create `backend/src/controllers/admin-courses.controller.ts`:

```ts
import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import {
  deleteCourseById,
  listCourses,
  listDeletedCourses,
  restoreCourseById,
} from '../models/admin-course.model.ts';

export async function getCourses(_req: Request, res: Response): Promise<void> {
  res.json({ items: await listCourses() });
}

export async function deleteCourse(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const deleted = await deleteCourseById(id);
  if (!deleted) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.status(204).end();
}

export async function getDeletedCourses(_req: Request, res: Response): Promise<void> {
  res.json({ items: await listDeletedCourses() });
}

export async function restoreCourseHandler(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const course = await restoreCourseById(id);
  if (!course) {
    res.status(404).json({ error: 'Deleted course not found' });
    return;
  }
  res.json({ course });
}
```

- [ ] **Step 5: Register the routes**

In `backend/src/routes/admin.routes.ts`, add the import:

```ts
import * as adminCourses from '../controllers/admin-courses.controller.ts';
```

and add these four lines (anywhere after the `adminRouter` declaration — order relative to the user routes doesn't matter, the paths don't overlap):

```ts
adminRouter.get('/courses', adminCourses.getCourses);
adminRouter.delete('/courses/:id', adminCourses.deleteCourse);
adminRouter.get('/courses/deleted', adminCourses.getDeletedCourses);
adminRouter.post('/courses/:id/restore', adminCourses.restoreCourseHandler);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w backend`
Expected: PASS, full suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/admin-course.model.ts backend/src/controllers/admin-courses.controller.ts backend/src/routes/admin.routes.ts backend/src/controllers/admin-courses.controller.test.ts
git commit -m "feat(admin): soft-delete and restore courses"
```

---

### Task 6: Frontend admin API client — users & courses

**Files:**
- Modify: `frontend/src/admin/api.ts` (full file below)

**Interfaces:**
- Consumes: `request` from `../lib/apiClient` (via `../auth/api`'s re-export, as today).
- Produces: `AdminUser` (own shape, no longer `= User`), `AdminCourse`, and `adminApi.listDeletedUsers`, `adminApi.restoreUser`, `adminApi.listCourses`, `adminApi.deleteCourse`, `adminApi.listDeletedCourses`, `adminApi.restoreCourse` — consumed by Tasks 7 and 8's pages.

- [ ] **Step 1: Replace the file**

Replace the full contents of `frontend/src/admin/api.ts` with:

```ts
import { request } from '../auth/api';

export type AdminUser = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  mustChangePassword: boolean;
  createdAt: string;
  isActive: boolean;
  deletedAt: string | null;
};

export type AdminCourse = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  subjectSlug: string;
  subjectTitle: string;
  isActive: boolean;
  deletedAt: string | null;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminAttempt = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
  answeredCount: number;
};

/**
 * Opaque from the frontend's point of view — it is parsed on the server and
 * handed back unmodified to /confirm. Typed as unknown rather than mirrored
 * field-for-field so this file does not have to track the backend's
 * ParsedSubject shape.
 */
export type ParsedSubjectPayload = unknown;

export type ImportSummary = { courses: number; questions: number };

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
};
export type SkippedUser = { firstName: string | null; lastName: string | null; reason: string };

export const adminApi = {
  listUsers: (page: number) => request<Page<AdminUser>>(`/admin/users?page=${page}`),

  listDeletedUsers: (page: number) =>
    request<Page<AdminUser>>(`/admin/users/deleted?page=${page}`),

  createUser: (firstName: string, lastName: string, role: 'user' | 'admin') =>
    request<{ user: AdminUser }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, role }),
    }),

  setRole: (id: string, role: 'user' | 'admin') =>
    request<{ user: AdminUser }>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  restoreUser: (id: string) =>
    request<{ user: AdminUser }>(`/admin/users/${id}/restore`, { method: 'POST' }),

  getUserAttempts: (id: string) =>
    request<{ attempts: AdminAttempt[] }>(`/admin/users/${id}/attempts`),

  listCourses: () => request<{ items: AdminCourse[] }>('/admin/courses'),

  deleteCourse: (id: string) => request<void>(`/admin/courses/${id}`, { method: 'DELETE' }),

  listDeletedCourses: () => request<{ items: AdminCourse[] }>('/admin/courses/deleted'),

  restoreCourse: (id: string) =>
    request<{ course: AdminCourse }>(`/admin/courses/${id}/restore`, { method: 'POST' }),

  parseImport: (file: File, subjectTitle: string) => {
    const form = new FormData();
    form.append('pdf', file);
    form.append('subjectTitle', subjectTitle);
    return request<{ subject: ParsedSubjectPayload; summary: ImportSummary } | { errors: string[] }>(
      '/admin/import/parse',
      { method: 'POST', body: form },
    );
  },

  confirmImport: (subject: ParsedSubjectPayload) =>
    request<ImportSummary>('/admin/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ subject }),
    }),

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
};
```

- [ ] **Step 2: Verify the frontend still typechecks**

Run: `npm run build -w frontend`
Expected: builds successfully — `AdminUsersPage.tsx` only reads `username`/`firstName`/`lastName`/`role`/`createdAt`/`id` off `AdminUser`, all still present on the new standalone type.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/admin/api.ts
git commit -m "feat(admin-ui): add recycle-bin and course API client methods"
```

---

### Task 7: Admin Courses page

**Files:**
- Create: `frontend/src/pages/admin/AdminCoursesPage.tsx`
- Test: Create `frontend/src/pages/admin/AdminCoursesPage.test.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/AccountMenu.tsx`

**Interfaces:**
- Consumes: `adminApi.listCourses`, `adminApi.deleteCourse`, `type AdminCourse` (Task 6); `TrashIcon` from `../../shell/icons` (exists today); `RequireAdmin` from `../../router` (exists today).
- Produces: `AdminCoursesPage` component, mounted at `/admin/courses`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AdminCoursesPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminCoursesPage } from './AdminCoursesPage';

const listCourses = vi.fn();
const deleteCourse = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listCourses: () => listCourses(),
    deleteCourse: (id: string) => deleteCourse(id),
  },
}));

beforeEach(() => {
  listCourses.mockResolvedValue({
    items: [
      {
        id: 'c1',
        slug: 'chassis-tire-and-rim-essentials',
        title: 'Tire and Rim Essentials',
        position: 1,
        passScore: 9,
        questionCount: 10,
        subjectSlug: 'chassis',
        subjectTitle: 'Chassis',
        isActive: true,
        deletedAt: null,
      },
    ],
  });
  deleteCourse.mockResolvedValue(undefined);
});

describe('AdminCoursesPage', () => {
  test('lists every course with its subject', async () => {
    render(<AdminCoursesPage />);
    expect(await screen.findByText('Tire and Rim Essentials')).toBeInTheDocument();
    expect(screen.getByText('Chassis')).toBeInTheDocument();
  });

  test('deleting a course calls deleteCourse and removes the row', async () => {
    render(<AdminCoursesPage />);
    await screen.findByText('Tire and Rim Essentials');
    const row = screen.getByText('Tire and Rim Essentials').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteCourse).toHaveBeenCalledWith('c1'));
    await waitFor(() =>
      expect(screen.queryByText('Tire and Rim Essentials')).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/AdminCoursesPage.test.tsx`
Expected: FAIL — `./AdminCoursesPage` does not exist.

- [ ] **Step 3: Create the page**

Create `frontend/src/pages/admin/AdminCoursesPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type AdminCourse } from '../../admin/api';
import { TrashIcon } from '../../shell/icons';

export function AdminCoursesPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (course: AdminCourse) => {
    setBusyId(course.id);
    try {
      await adminApi.deleteCourse(course.id);
      toast.success('Course deleted');
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete course');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Courses</h1>

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
              <th>Subject</th>
              <th>Course</th>
              <th>Position</th>
              <th>Pass score</th>
              <th>Questions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td data-label="Subject">{c.subjectTitle}</td>
                <td data-label="Course">{c.title}</td>
                <td data-label="Position">{c.position}</td>
                <td data-label="Pass score">{c.passScore}</td>
                <td data-label="Questions">{c.questionCount}</td>
                <td className="admin-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === c.id}
                    onClick={() => void remove(c)}
                    aria-label="Delete"
                    title="Delete"
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/AdminCoursesPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire up the route**

In `frontend/src/router.tsx`, add the import after the `AdminImportPage` import:

```tsx
import { AdminCoursesPage } from './pages/admin/AdminCoursesPage';
```

Add the route after the `/admin/import` route:

```tsx
          <Route
            path="/admin/courses"
            element={
              <RequireAdmin>
                <AdminCoursesPage />
              </RequireAdmin>
            }
          />
```

- [ ] **Step 6: Add the nav link**

In `frontend/src/shell/AccountMenu.tsx`, add this `<li>` right after the `/admin/import` link:

```tsx
            <li>
              <NavLink to="/admin/courses" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Courses
              </NavLink>
            </li>
```

- [ ] **Step 7: Run the full frontend test suite**

Run: `npm run test -w frontend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/AdminCoursesPage.tsx frontend/src/pages/admin/AdminCoursesPage.test.tsx frontend/src/router.tsx frontend/src/shell/AccountMenu.tsx
git commit -m "feat(admin-ui): add admin Courses page with delete"
```

---

### Task 8: Recycle Bin page (Deleted Users / Deleted Courses, with restore)

**Files:**
- Modify: `frontend/src/shell/icons.tsx` (add `RestoreIcon`)
- Create: `frontend/src/pages/admin/RecycleBinPage.tsx`
- Test: Create `frontend/src/pages/admin/RecycleBinPage.test.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/AccountMenu.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `adminApi.listDeletedUsers`, `adminApi.restoreUser`, `adminApi.listDeletedCourses`, `adminApi.restoreCourse`, `type AdminUser`, `type AdminCourse` (Task 6); `Pager`/`usePager` (exist today, used only for the Users tab, which is paginated server-side — the Courses tab renders its full unpaginated list per the design spec).
- Produces: `RecycleBinPage` component, mounted at `/admin/recycle-bin`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/RecycleBinPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RecycleBinPage } from './RecycleBinPage';

const listDeletedUsers = vi.fn();
const restoreUser = vi.fn();
const listDeletedCourses = vi.fn();
const restoreCourse = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
}));

vi.mock('../../admin/api', () => ({
  adminApi: {
    listDeletedUsers: (page: number) => listDeletedUsers(page),
    restoreUser: (id: string) => restoreUser(id),
    listDeletedCourses: () => listDeletedCourses(),
    restoreCourse: (id: string) => restoreCourse(id),
  },
}));

beforeEach(() => {
  listDeletedUsers.mockResolvedValue({
    items: [
      {
        id: 'u1',
        username: 'gonezo',
        firstName: 'Gone',
        lastName: 'Zo',
        role: 'user',
        mustChangePassword: false,
        createdAt: '2026-11-01T00:00:00Z',
        isActive: false,
        deletedAt: '2026-11-05T00:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  restoreUser.mockResolvedValue({ user: {} });
  listDeletedCourses.mockResolvedValue({
    items: [
      {
        id: 'c1',
        slug: 'chassis-tire-and-rim-essentials',
        title: 'Tire and Rim Essentials',
        position: 1,
        passScore: 9,
        questionCount: 10,
        subjectSlug: 'chassis',
        subjectTitle: 'Chassis',
        isActive: false,
        deletedAt: '2026-11-05T00:00:00Z',
      },
    ],
  });
  restoreCourse.mockResolvedValue({ course: {} });
});

describe('RecycleBinPage', () => {
  test('shows deleted users by default', async () => {
    render(<RecycleBinPage />);
    expect(await screen.findByText('gonezo')).toBeInTheDocument();
  });

  test('restoring a user calls restoreUser and removes the row', async () => {
    render(<RecycleBinPage />);
    await screen.findByText('gonezo');
    const row = screen.getByText('gonezo').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreUser).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('gonezo')).not.toBeInTheDocument());
  });

  test('switching to the Courses tab loads deleted courses', async () => {
    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deleted Courses' }));
    expect(await screen.findByText('Tire and Rim Essentials')).toBeInTheDocument();
  });

  test('restoring a course calls restoreCourse and removes the row', async () => {
    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deleted Courses' }));
    await screen.findByText('Tire and Rim Essentials');
    const row = screen.getByText('Tire and Rim Essentials').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreCourse).toHaveBeenCalledWith('c1'));
    await waitFor(() =>
      expect(screen.queryByText('Tire and Rim Essentials')).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/RecycleBinPage.test.tsx`
Expected: FAIL — `./RecycleBinPage` does not exist.

- [ ] **Step 3: Add the restore icon**

In `frontend/src/shell/icons.tsx`, add this export after `SignOutIcon`:

```tsx
/** Circular arrow: restoring a soft-deleted row. */
export function RestoreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12a7.5 7.5 0 1113-5.5" />
      <path d="M4.5 4.5v5h5" />
    </svg>
  );
}
```

- [ ] **Step 4: Create the page**

Create `frontend/src/pages/admin/RecycleBinPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type AdminCourse, type AdminUser } from '../../admin/api';
import { Pager } from '../../shared/Pager';
import { usePager } from '../../shared/usePager';
import { RestoreIcon } from '../../shell/icons';

type Tab = 'users' | 'courses';

export function RecycleBinPage() {
  const [tab, setTab] = useState<Tab>('users');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const usersPager = usePager(usersTotal);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersBusyId, setUsersBusyId] = useState<string | null>(null);

  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesBusyId, setCoursesBusyId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback((page: number) => {
    setUsersLoading(true);
    adminApi
      .listDeletedUsers(page)
      .then((res) => {
        setUsers(res.items);
        setUsersTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setUsersLoading(false));
  }, []);

  const loadCourses = useCallback(() => {
    setCoursesLoading(true);
    adminApi
      .listDeletedCourses()
      .then((res) => setCourses(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setCoursesLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'users') loadUsers(usersPager.page);
  }, [tab, loadUsers, usersPager.page]);

  useEffect(() => {
    if (tab === 'courses') loadCourses();
  }, [tab, loadCourses]);

  const restoreUser = async (user: AdminUser) => {
    setUsersBusyId(user.id);
    try {
      await adminApi.restoreUser(user.id);
      toast.success('User restored');
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setUsersTotal((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore user');
    } finally {
      setUsersBusyId(null);
    }
  };

  const restoreCourse = async (course: AdminCourse) => {
    setCoursesBusyId(course.id);
    try {
      await adminApi.restoreCourse(course.id);
      toast.success('Course restored');
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore course');
    } finally {
      setCoursesBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Recycle Bin</h1>

      <div className="recycle-bin-tabs">
        <button
          type="button"
          className={tab === 'users' ? 'recycle-bin-tab active' : 'recycle-bin-tab'}
          onClick={() => setTab('users')}
        >
          Deleted Users
        </button>
        <button
          type="button"
          className={tab === 'courses' ? 'recycle-bin-tab active' : 'recycle-bin-tab'}
          onClick={() => setTab('courses')}
        >
          Deleted Courses
        </button>
      </div>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {tab === 'users' &&
        (usersLoading ? (
          <p>Loading…</p>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Deleted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="First Name">{u.firstName ?? '—'}</td>
                    <td data-label="Last Name">{u.lastName ?? '—'}</td>
                    <td data-label="Deleted">
                      {u.deletedAt ? new Date(u.deletedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={usersBusyId === u.id}
                        onClick={() => void restoreUser(u)}
                        aria-label="Restore"
                        title="Restore"
                      >
                        <RestoreIcon className="icon-button-icon" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager
              page={usersPager.page}
              totalPages={usersPager.totalPages}
              canPrev={usersPager.canPrev}
              canNext={usersPager.canNext}
              onPrev={usersPager.prev}
              onNext={usersPager.next}
            />
          </>
        ))}

      {tab === 'courses' &&
        (coursesLoading ? (
          <p>Loading…</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Course</th>
                <th>Deleted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td data-label="Subject">{c.subjectTitle}</td>
                  <td data-label="Course">{c.title}</td>
                  <td data-label="Deleted">
                    {c.deletedAt ? new Date(c.deletedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="admin-actions">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={coursesBusyId === c.id}
                      onClick={() => void restoreCourse(c)}
                      aria-label="Restore"
                      title="Restore"
                    >
                      <RestoreIcon className="icon-button-icon" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
```

- [ ] **Step 5: Add the tab CSS**

In `frontend/src/App.css`, add these rules right after the `.admin-pager` rule:

```css
.recycle-bin-tabs { display: flex; gap: 0.5rem; margin: 1rem 0 1.5rem; }
.recycle-bin-tab {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.recycle-bin-tab:hover { background: var(--accent-bg); }
.recycle-bin-tab.active { background: var(--accent-bg); border-color: var(--accent-border); font-weight: 600; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/RecycleBinPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire up the route**

In `frontend/src/router.tsx`, add the import after the `AdminCoursesPage` import (added in Task 7):

```tsx
import { RecycleBinPage } from './pages/admin/RecycleBinPage';
```

Add the route after `/admin/courses`:

```tsx
          <Route
            path="/admin/recycle-bin"
            element={
              <RequireAdmin>
                <RecycleBinPage />
              </RequireAdmin>
            }
          />
```

- [ ] **Step 8: Add the nav link**

In `frontend/src/shell/AccountMenu.tsx`, add this `<li>` right after the `/admin/courses` link added in Task 7:

```tsx
            <li>
              <NavLink to="/admin/recycle-bin" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Recycle Bin
              </NavLink>
            </li>
```

- [ ] **Step 9: Run the full test suites and typecheck**

Run: `npm run test` (root — runs both backend and frontend suites)
Expected: PASS.

Run: `npm run typecheck` (root — backend `tsc --noEmit` + frontend `vite build`)
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/shell/icons.tsx frontend/src/pages/admin/RecycleBinPage.tsx frontend/src/pages/admin/RecycleBinPage.test.tsx frontend/src/router.tsx frontend/src/shell/AccountMenu.tsx frontend/src/App.css
git commit -m "feat(admin-ui): add Recycle Bin page for restoring deleted users and courses"
```

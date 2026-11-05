# List Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offset-based pagination (fixed page size of 20) to the Admin Users table and the admin user-import preview/results tables, via one shared pagination mechanism on each side of the stack.

**Architecture:** Backend gets a tiny `pagination.ts` helper (`PAGE_SIZE`, `parsePage`, `Page<T>` type) used by the users list endpoint, which now does a `.limit().offset()` query plus a separate `count()` query and returns `{ items, total, page, pageSize }`. Frontend gets a shared `usePager(totalItems)` hook plus a `<Pager>` component, used three ways on `AdminUsersPage`: once against the server-paginated users table, and twice against in-memory arrays (import preview rows, import results) that page client-side with no refetch.

**Tech Stack:** Express 5 + Drizzle ORM + Postgres (backend, `node:test`); React 19 + Vite (frontend, Vitest + Testing Library).

## Global Constraints

- Page size is fixed at `20`, not user-adjustable, on both sides of the stack (per spec).
- Response envelope for any paginated list endpoint: `{ items: T[], total: number, page: number, pageSize: number }` (per spec).
- The courses-by-subject list (`SubjectCoursesPage.tsx` / `listCoursesBySubject()`) is explicitly **out of scope** — do not touch it.
- No zod schema exists for query-string params anywhere in this codebase yet (query params are read with loose `typeof req.query.x === 'string'` checks) — `parsePage` follows that existing style rather than introducing zod-for-query as a new pattern.

---

### Task 1: Backend pagination helper

**Files:**
- Create: `backend/src/lib/pagination.ts`
- Test: `backend/src/lib/pagination.test.ts`

**Interfaces:**
- Produces: `PAGE_SIZE: number` (= 20), `type Page<T> = { items: T[]; total: number; page: number; pageSize: number }`, `parsePage(req: Request): number`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/lib/pagination.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { parsePage } from './pagination.ts';

function fakeRequest(page: unknown): Request {
  return { query: { page } } as unknown as Request;
}

test('parsePage defaults to 1 when page is missing', () => {
  assert.equal(parsePage(fakeRequest(undefined)), 1);
});

test('parsePage parses a valid numeric string', () => {
  assert.equal(parsePage(fakeRequest('3')), 3);
});

test('parsePage clamps zero and negative values to 1', () => {
  assert.equal(parsePage(fakeRequest('0')), 1);
  assert.equal(parsePage(fakeRequest('-5')), 1);
});

test('parsePage clamps non-numeric input to 1', () => {
  assert.equal(parsePage(fakeRequest('abc')), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/lib/pagination.test.ts`
Expected: FAIL — `pagination.ts` does not exist / `parsePage` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/lib/pagination.ts
import type { Request } from 'express';

export const PAGE_SIZE = 20;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Reads `page` from the query string. Defaults to 1 and clamps to >= 1 for
 * any missing/non-numeric/negative input, matching the loose req.query
 * handling already used elsewhere in this codebase (e.g. catalog.controller.ts).
 */
export function parsePage(req: Request): number {
  const raw = req.query.page;
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 1 ? value : 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/lib/pagination.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/pagination.ts backend/src/lib/pagination.test.ts
git commit -m "feat(backend): add shared pagination helper"
```

---

### Task 2: Paginate the users model query

**Files:**
- Modify: `backend/src/models/admin-user.model.ts`
- Test: `backend/src/models/admin-user.model.test.ts` (create)

**Interfaces:**
- Consumes: `PAGE_SIZE` from `../lib/pagination.ts` (Task 1).
- Produces: `listUsers(page: number): Promise<PublicUser[]>` (signature change — previously took no args), `countUsers(): Promise<number>` (new).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/models/admin-user.model.test.ts
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
    email: `user${String(i).padStart(3, '0')}@example.com`,
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
  assert.equal(page1[0]!.email, 'user000@example.com');
  assert.equal(page2[0]!.email, `user${String(PAGE_SIZE).padStart(3, '0')}@example.com`);
});

test('countUsers returns the total row count regardless of page size', async () => {
  await seedUsers(PAGE_SIZE + 5);
  assert.equal(await countUsers(), PAGE_SIZE + 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/models/admin-user.model.test.ts`
Expected: FAIL — `countUsers` is not exported (TypeError), and/or `page1.length`/`page2.length` are both 25 since `listUsers` currently ignores its argument and has no limit.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/models/admin-user.model.ts
import { count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';
import { users } from './schema.ts';
import type { PublicUser } from './user.model.ts';

const publicColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};

export async function listUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .orderBy(users.createdAt)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
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

/** True if a row was deleted. */
export async function deleteUserById(id: string): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return result.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/models/admin-user.model.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/admin-user.model.ts backend/src/models/admin-user.model.test.ts
git commit -m "feat(backend): paginate listUsers and add countUsers"
```

---

### Task 3: Wire the users endpoint to return a paginated envelope

**Files:**
- Modify: `backend/src/controllers/admin-users.controller.ts`
- Modify: `backend/src/controllers/admin-users.controller.test.ts`

**Interfaces:**
- Consumes: `listUsers(page)`, `countUsers()` (Task 2); `PAGE_SIZE`, `parsePage(req)` (Task 1).
- Produces: `GET /api/v1/admin/users` now responds `{ items, total, page, pageSize }` instead of `{ users }`.

- [ ] **Step 1: Update the existing tests for the new response shape, and add a pagination-metadata test**

In `backend/src/controllers/admin-users.controller.test.ts`, replace the body of the `'GET /api/v1/admin/users lists users for an admin'` test:

```ts
test('GET /api/v1/admin/users lists users for an admin', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ email: string }> };
  const emails = body.items.map((u) => u.email).sort();
  assert.deepEqual(emails, ['admin@example.com', 'student@example.com']);
});
```

Add a new test right after it:

```ts
test('GET /api/v1/admin/users includes pagination metadata', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await res.json()) as { total: number; page: number; pageSize: number };
  assert.equal(body.total, 2);
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 20);
});
```

And in the `'DELETE removes a user'` test, change:

```ts
  const list = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { users: Array<{ email: string }> };
  assert.equal(body.users.some((u) => u.email === 'student@example.com'), false);
```

to:

```ts
  const list = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { items: Array<{ email: string }> };
  assert.equal(body.items.some((u) => u.email === 'student@example.com'), false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/controllers/admin-users.controller.test.ts`
Expected: FAIL — the handler still returns `{ users }`, so `body.items` is `undefined` and `body.total`/`body.page`/`body.pageSize` are `undefined`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/controllers/admin-users.controller.ts
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

const roleBody = z.object({ role: z.enum(['user', 'admin']) });

export async function getUsers(req: Request, res: Response): Promise<void> {
  const page = parsePage(req);
  const [items, total] = await Promise.all([listUsers(page), countUsers()]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --env-file=.env.test --test --test-concurrency=1 src/controllers/admin-users.controller.test.ts`
Expected: PASS (all tests in the file, including the two updated ones and the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin-users.controller.ts backend/src/controllers/admin-users.controller.test.ts
git commit -m "feat(backend): return paginated envelope from GET /admin/users"
```

---

### Task 4: Update the frontend admin API client

**Files:**
- Modify: `frontend/src/admin/api.ts`

**Interfaces:**
- Produces: `export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }`; `adminApi.listUsers(page: number): Promise<Page<AdminUser>>` (signature change — previously took no args and returned `{ users: AdminUser[] }`).

There's no existing test file for `admin/api.ts` (it's a thin wrapper over `request()`, exercised indirectly through `AdminUsersPage.test.tsx` in Task 7) — this task is a direct, minimal edit.

- [ ] **Step 1: Edit `frontend/src/admin/api.ts`**

Add the `Page` type near the top (after the `AdminUser` export):

```ts
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

Change the `listUsers` entry in `adminApi`:

```ts
  listUsers: (page: number) => request<Page<AdminUser>>(`/admin/users?page=${page}`),
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: errors at every call site that still calls `adminApi.listUsers()` with no argument or destructures `.users` — these are fixed in Task 7. If no other call sites exist yet, this step should pass; if it reports `AdminUsersPage.tsx` errors, that's expected and resolved by Task 7 — do not fix them here.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/admin/api.ts
git commit -m "feat(frontend): paginate adminApi.listUsers"
```

---

### Task 5: Shared `usePager` hook

**Files:**
- Create: `frontend/src/shared/usePager.ts`
- Test: `frontend/src/shared/usePager.test.ts`

**Interfaces:**
- Produces: `PAGE_SIZE = 20`; `usePager(totalItems: number): { page: number; totalPages: number; canPrev: boolean; canNext: boolean; next: () => void; prev: () => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/shared/usePager.test.ts
import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PAGE_SIZE, usePager } from './usePager';

describe('usePager', () => {
  test('starts on page 1 and computes totalPages from totalItems', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE * 2 + 1));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.canPrev).toBe(false);
    expect(result.current.canNext).toBe(true);
  });

  test('prev() does nothing on page 1', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE * 2));
    act(() => result.current.prev());
    expect(result.current.page).toBe(1);
  });

  test('next() stops at the last page', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE + 5));
    expect(result.current.totalPages).toBe(2);
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    expect(result.current.canNext).toBe(false);
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
  });

  test('resets to the new last page when totalItems shrinks below the current page', () => {
    const { result, rerender } = renderHook(({ total }) => usePager(total), {
      initialProps: { total: PAGE_SIZE * 3 },
    });
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3);

    rerender({ total: PAGE_SIZE + 2 });
    expect(result.current.page).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/shared/usePager.test.ts`
Expected: FAIL — `./usePager` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/shared/usePager.ts
import { useEffect, useState } from 'react';

export const PAGE_SIZE = 20;

export function usePager(totalItems: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return {
    page,
    totalPages,
    canPrev: page > 1,
    canNext: page < totalPages,
    next: () => setPage((p) => Math.min(p + 1, totalPages)),
    prev: () => setPage((p) => Math.max(p - 1, 1)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/usePager.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/usePager.ts frontend/src/shared/usePager.test.ts
git commit -m "feat(frontend): add shared usePager hook"
```

---

### Task 6: Shared `Pager` component

**Files:**
- Create: `frontend/src/shared/Pager.tsx`
- Test: `frontend/src/shared/Pager.test.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: nothing (pure presentational component; the caller passes the fields returned by `usePager`, Task 5).
- Produces: `<Pager page={number} totalPages={number} canPrev={boolean} canNext={boolean} onPrev={() => void} onNext={() => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/shared/Pager.test.tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pager } from './Pager';

describe('Pager', () => {
  test('shows the current page and total', () => {
    render(<Pager page={2} totalPages={5} canPrev canNext onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  test('disables Prev on the first page and Next on the last page', () => {
    render(
      <Pager page={1} totalPages={1} canPrev={false} canNext={false} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('calls onPrev/onNext when clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pager page={2} totalPages={3} canPrev canNext onPrev={onPrev} onNext={onNext} />);
    screen.getByRole('button', { name: 'Prev' }).click();
    screen.getByRole('button', { name: 'Next' }).click();
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/shared/Pager.test.tsx`
Expected: FAIL — `./Pager` does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/shared/Pager.tsx
type PagerProps = {
  page: number;
  totalPages: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function Pager({ page, totalPages, canPrev, canNext, onPrev, onNext }: PagerProps) {
  return (
    <div className="admin-pager">
      <button type="button" className="auth-submit-secondary" disabled={!canPrev} onClick={onPrev}>
        Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" className="auth-submit-secondary" disabled={!canNext} onClick={onNext}>
        Next
      </button>
    </div>
  );
}
```

Add the matching style in `frontend/src/App.css` right after the existing `.admin-actions` rule (currently at line 556):

```css
.admin-pager { display: flex; align-items: center; gap: 1rem; margin-top: 1rem; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/Pager.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/Pager.tsx frontend/src/shared/Pager.test.tsx frontend/src/App.css
git commit -m "feat(frontend): add shared Pager component"
```

---

### Task 7: Paginate the Admin Users table (server-driven)

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `adminApi.listUsers(page)` → `Page<AdminUser>` (Task 4); `usePager(totalItems)` (Task 5); `<Pager>` (Task 6).

- [ ] **Step 1: Update the test mocks and add a page-interaction test**

In `frontend/src/pages/admin/AdminUsersPage.test.tsx`, change the `vi.mock('../../admin/api', ...)` block's `listUsers` line:

```ts
    listUsers: (page: number) => listUsers(page),
```

Change the `beforeEach` mock data:

```ts
  listUsers.mockResolvedValue({
    items: [
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
    total: 2,
    page: 1,
    pageSize: 20,
  });
```

Add a new test (anywhere inside the `describe('AdminUsersPage', ...)` block):

```tsx
  test('clicking Next requests the next page and updates the table', async () => {
    listUsers.mockImplementation((page: number) =>
      Promise.resolve(
        page === 1
          ? {
              items: [
                {
                  id: 'me',
                  email: 'admin@example.com',
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
                  email: 'student@example.com',
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
    await screen.findByText('admin@example.com');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(2));
    expect(await screen.findByText('student@example.com')).toBeInTheDocument();
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: FAIL — the page still reads `res.users` (now `undefined`) and renders nothing, and there is no "Next" button or "Page X of Y" text yet.

- [ ] **Step 3: Update `AdminUsersPage.tsx`**

Add imports at the top:

```tsx
import { Pager } from '../../shared/Pager';
import { usePager } from '../../shared/usePager';
```

Replace the `users`/`load` state and effect:

```tsx
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const pager = usePager(total);
```

(keep `loading`, `error`, `busyId` and the rest of the existing state declarations unchanged, directly below the lines above)

Replace the `load` callback and its effect:

```tsx
  const load = useCallback((page: number) => {
    setLoading(true);
    adminApi
      .listUsers(page)
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(pager.page);
  }, [load, pager.page]);
```

Update `remove` to keep `total` in sync with the locally-spliced array (so the pager doesn't think there are more pages than exist after a delete):

```tsx
  const remove = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      await adminApi.deleteUser(target.id);
      toast.success('User deleted');
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };
```

Update `confirmImport`'s refresh call from `load();` to `load(pager.page);`.

Add the `<Pager>` right after the closing `</table>` of the main users table (before the `{modalUserId && ...}` block):

```tsx
      {!loading && (
        <Pager
          page={pager.page}
          totalPages={pager.totalPages}
          canPrev={pager.canPrev}
          canNext={pager.canNext}
          onPrev={pager.prev}
          onNext={pager.next}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS (all existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(frontend): paginate the Admin Users table"
```

---

### Task 8: Paginate the import preview table (client-driven)

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `usePager(totalItems)` (Task 5), `<Pager>` (Task 6), `PAGE_SIZE` (Task 5).

- [ ] **Step 1: Add a failing test**

Add this helper and test to `AdminUsersPage.test.tsx` (helper goes near `manyAttempts`, test goes inside the `describe` block):

```tsx
  function manyImportRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      row: i + 2,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      email: `user${i}@example.com`,
      role: 'user' as const,
    }));
  }

  test('paginates the import preview table when there are more than one page of rows', async () => {
    parseUserImport.mockResolvedValue({ rows: manyImportRows(25), errors: [] });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));

    expect(await screen.findByText('user0@example.com')).toBeInTheDocument();
    expect(screen.queryByText('user20@example.com')).not.toBeInTheDocument();

    const previewSection = screen.getByText('user0@example.com').closest('.import-preview')!;
    fireEvent.click(within(previewSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('user20@example.com')).toBeInTheDocument();
    expect(screen.queryByText('user0@example.com')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/pages/admin/AdminUsersPage.test.tsx -t "import preview"`
Expected: FAIL — all 25 rows render with no "Next" button inside `.import-preview`.

- [ ] **Step 3: Update the import preview table in `AdminUsersPage.tsx`**

Add `const previewPager = usePager(parsedRows.length);` alongside the other state/derived values near the top of the component (e.g. right after the `pager` declaration from Task 7).

Change the preview table body and add a `<Pager>` below it:

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
                      <td>{r.firstName ?? '—'}</td>
                      <td>{r.lastName ?? '—'}</td>
                      <td>{r.email}</td>
                      <td>{r.role}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <Pager
              page={previewPager.page}
              totalPages={previewPager.totalPages}
              canPrev={previewPager.canPrev}
              canNext={previewPager.canNext}
              onPrev={previewPager.prev}
              onNext={previewPager.next}
            />
```

Add `PAGE_SIZE` to the existing `usePager` import:

```tsx
import { PAGE_SIZE, usePager } from '../../shared/usePager';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(frontend): paginate the user-import preview table"
```

---

### Task 9: Paginate the import results tables (client-driven)

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `usePager(totalItems)`, `PAGE_SIZE` (Task 5), `<Pager>` (Task 6).

- [ ] **Step 1: Add failing tests**

Add these helpers and tests to `AdminUsersPage.test.tsx`:

```tsx
  function manyConfirmedUsers(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      email: `created${i}@example.com`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      role: 'user' as const,
      password: `pw${i}`,
    }));
  }

  function manySkippedUsers(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      email: `skipped${i}@example.com`,
      reason: 'already registered',
    }));
  }

  test('paginates the import results "Created" table when there are more than one page', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({ created: manyConfirmedUsers(25), skipped: [] });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    expect(await screen.findByText('created0@example.com')).toBeInTheDocument();
    expect(screen.queryByText('created20@example.com')).not.toBeInTheDocument();

    const createdSection = screen.getByText('Created').closest('.import-results')!;
    fireEvent.click(within(createdSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('created20@example.com')).toBeInTheDocument();
  });

  test('paginates the import results "Skipped" list when there are more than one page', async () => {
    parseUserImport.mockResolvedValue({
      rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({ created: [], skipped: manySkippedUsers(25) });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    expect(await screen.findByText(/skipped0@example.com/)).toBeInTheDocument();
    expect(screen.queryByText(/skipped20@example.com/)).not.toBeInTheDocument();

    const skippedSection = screen.getByText('Skipped').closest('.import-results')!;
    fireEvent.click(within(skippedSection).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/skipped20@example.com/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/pages/admin/AdminUsersPage.test.tsx -t "import results"`
Expected: FAIL — all 25 rows render in each table with no "Next" button inside `.import-results`.

- [ ] **Step 3: Update the import results tables in `AdminUsersPage.tsx`**

Add two more pager instances alongside `previewPager`:

```tsx
  const createdPager = usePager(importResults?.created.length ?? 0);
  const skippedPager = usePager(importResults?.skipped.length ?? 0);
```

Update the "Created" table body and add a `<Pager>` below it:

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
                    {importResults.created
                      .slice((createdPager.page - 1) * PAGE_SIZE, createdPager.page * PAGE_SIZE)
                      .map((u) => (
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
                <Pager
                  page={createdPager.page}
                  totalPages={createdPager.totalPages}
                  canPrev={createdPager.canPrev}
                  canNext={createdPager.canNext}
                  onPrev={createdPager.prev}
                  onNext={createdPager.next}
                />
```

Update the "Skipped" list and add a `<Pager>` below it:

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
                <Pager
                  page={skippedPager.page}
                  totalPages={skippedPager.totalPages}
                  canPrev={skippedPager.canPrev}
                  canNext={skippedPager.canNext}
                  onPrev={skippedPager.prev}
                  onNext={skippedPager.next}
                />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS — the full file, all tests.

- [ ] **Step 5: Run the full test suites one last time**

Run (from `backend/`): `npm test`
Run (from `frontend/`): `npx vitest run`
Expected: PASS on both.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(frontend): paginate the user-import results tables"
```

# Profile & Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give any signed-in user a `/profile` page showing their email and role, with a change-password form that requires their current password and revokes every other session on success.

**Architecture:** One new backend endpoint (`PATCH /api/auth/password`) reusing the existing cookie-session auth stack (argon2, `session.model.ts`, `startSession`); one new frontend page (`ProfilePage`) reusing the existing `auth-form`/`auth-fields`/`auth-submit` CSS and `authApi` request helper. No schema change.

**Tech Stack:** Node/Express 5 (ESM, `tsx`), `node:test` + `node:assert/strict` for backend tests, Drizzle ORM, `argon2`, `zod`; React 19 + Vite, `react-router`, Vitest + `@testing-library/react` for frontend tests.

## Global Constraints

- Password length rule is 8–256 chars, defined once in `backend/src/controllers/auth.controller.ts`'s `credentials` schema — the new endpoint must reuse `credentials.shape.password`, not redeclare the rule.
- Session cookie behavior (`SESSION_COOKIE`, `sessionCookieOptions`, `SESSION_TTL_MS`) lives in `backend/src/lib/cookies.ts` — do not duplicate it.
- `deleteSessionsForUser` already exists in `backend/src/models/session.model.ts:37-39` specifically for this feature — use it, don't write a new session-deletion query.
- Frontend styling must reuse the existing `auth-form` / `auth-fields` / `auth-submit` / `auth-error` / `auth-hint` classes (see `frontend/src/auth/LoginForm.tsx` and `frontend/src/pages/admin/AdminImportPage.tsx` for the established pattern of narrowing them with a page-specific class).
- No new icon library — icons are hand-drawn inline SVGs in `frontend/src/shell/icons.tsx` using the shared `base` stroke config.

---

### Task 1: Backend — user model additions

**Files:**
- Modify: `backend/src/models/user.model.ts`
- Test: `backend/src/models/user.model.test.ts`

**Interfaces:**
- Produces: `findUserByIdWithHash(id: string): Promise<(PublicUser & { passwordHash: string }) | null>`
- Produces: `updatePasswordHash(id: string, passwordHash: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/models/user.model.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser, findUserByIdWithHash, updatePasswordHash } from './user.model.ts';

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

test('findUserByIdWithHash returns the hash for a known user', async () => {
  const user = await createUser('hash-lookup@example.com', 'some-hash');
  const found = await findUserByIdWithHash(user!.id);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByIdWithHash returns null for an unknown id', async () => {
  const found = await findUserByIdWithHash('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});

test('updatePasswordHash persists the new hash', async () => {
  const user = await createUser('update-hash@example.com', 'old-hash');
  await updatePasswordHash(user!.id, 'new-hash');
  const found = await findUserByIdWithHash(user!.id);
  assert.equal(found?.passwordHash, 'new-hash');
});
```

This replaces the whole file's existing content (the imports/`before`/`after`/`beforeEach` block and the one existing test) with the version above — it's the same scaffolding plus the three new tests and two new imports.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd backend && npm test -- user.model.test.ts`
Expected: FAIL — `findUserByIdWithHash` and `updatePasswordHash` are not exported from `./user.model.ts`

- [ ] **Step 3: Implement the two functions**

In `backend/src/models/user.model.ts`, after the existing `findUserByEmailWithHash` function (currently ending at line 40), add:

```ts
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- user.model.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/models/user.model.test.ts
git commit -m "feat(api): add findUserByIdWithHash and updatePasswordHash"
```

---

### Task 2: Backend — change-password endpoint

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Test: `backend/src/controllers/auth.controller.test.ts`

**Interfaces:**
- Consumes: `findUserByIdWithHash`, `updatePasswordHash` from Task 1; `deleteSessionsForUser` from `backend/src/models/session.model.ts:37-39`; `startSession` (private helper already in `auth.controller.ts:27-34`); `credentials` schema already in `auth.controller.ts:14-17`.
- Produces: `changePassword(req: Request, res: Response): Promise<void>`, mounted as `PATCH /api/auth/password` (requires `requireAuth`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/controllers/auth.controller.test.ts` with the version below — it keeps the existing login test, adds `registerTestUser` to the import, and adds four new tests:

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

test('POST /api/auth/login returns the role, not just id/email/createdAt', async () => {
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-role@example.com', password: 'test-password-123' }),
  });

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-role@example.com', password: 'test-password-123' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string; passwordHash?: string } };
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.passwordHash, undefined);
});

test('PATCH /api/auth/password rejects a wrong current password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-wrong@example.com');

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/password rejects a too-short new password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-short@example.com');

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/auth/password requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/password changes the password, revokes other sessions, keeps this one', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-change@example.com');

  // A second "device": log in again to get an independent session cookie.
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw-change@example.com', password: 'test-password-123' }),
  });
  const otherCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-456' }),
  });
  assert.equal(res.status, 204);
  const newCookie = res.headers.get('set-cookie')!.split(';')[0]!;

  // The other device's session is revoked.
  const otherMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: otherCookie } });
  assert.equal(otherMe.status, 401);

  // This device's *old* cookie is revoked too (it was swapped for a fresh one).
  const oldMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(oldMe.status, 401);

  // This device continues on the newly issued cookie.
  const newMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: newCookie } });
  assert.equal(newMe.status, 200);

  // The new password actually works for a fresh login.
  const relogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw-change@example.com', password: 'new-password-456' }),
  });
  assert.equal(relogin.status, 200);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd backend && npm test -- auth.controller.test.ts`
Expected: FAIL — `PATCH /api/auth/password` 404s (route doesn't exist yet)

- [ ] **Step 3: Implement the controller**

In `backend/src/controllers/auth.controller.ts`, add these imports to the existing import block at the top (merging with what's already imported from each module):

```ts
import { deleteSession, deleteSessionsForUser, insertSession } from '../models/session.model.ts';
import {
  createUser,
  findUserByEmailWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
} from '../models/user.model.ts';
```

(This replaces the existing two import lines for `session.model.ts` and `user.model.ts`.)

Then add, after the `logout` function (after line 101) and before `me`:

```ts
const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: credentials.shape.password,
});

/**
 * Changes the signed-in user's password. Requires the current password.
 * Revokes every other session for this user, then issues a fresh session for
 * the current request so this device stays signed in.
 * @param req
 * @param res
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const existing = await findUserByIdWithHash(req.user!.id);
  const ok = existing ? await argon2.verify(existing.passwordHash, currentPassword) : false;

  if (!existing || !ok) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await updatePasswordHash(existing.id, passwordHash);

  await deleteSessionsForUser(existing.id);
  await startSession(res, existing.id);

  res.status(204).end();
}
```

- [ ] **Step 4: Wire the route**

Replace the full contents of `backend/src/routes/auth.routes.ts` with:

```ts
import { Router } from 'express';
import * as auth from '../controllers/auth.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const authRouter = Router();

authRouter.post('/register', auth.register);
authRouter.post('/login', auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', requireAuth, auth.me);
authRouter.patch('/password', requireAuth, auth.changePassword);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- auth.controller.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS (all tests, no regressions)

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/controllers/auth.controller.test.ts backend/src/routes/auth.routes.ts
git commit -m "feat(api): add PATCH /auth/password to change the current user's password"
```

---

### Task 3: Frontend — `authApi.changePassword` client

**Files:**
- Modify: `frontend/src/auth/api.ts`

**Interfaces:**
- Consumes: `request<T>` already defined in this file.
- Produces: `authApi.changePassword(currentPassword: string, newPassword: string): Promise<void>`

- [ ] **Step 1: Add the client method**

In `frontend/src/auth/api.ts`, add to the `authApi` object (after `register`, before `logout`):

```ts
export const authApi = {
  me: () => request<{ user: User }>('/auth/me'),

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

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
```

There's no unit test for this file today (it's exercised through the backend integration tests and will be exercised by `ProfilePage`'s test in Task 4) — this step is verified by Task 4's test suite calling through the mocked module shape, and by the backend tests in Task 2 confirming the wire contract.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/auth/api.ts
git commit -m "feat(web): add authApi.changePassword"
```

---

### Task 4: Frontend — `ProfilePage`

**Files:**
- Create: `frontend/src/pages/ProfilePage.tsx`
- Create: `frontend/src/pages/ProfilePage.test.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `useAuth()` from `frontend/src/auth/useAuth.ts` (returns `{ user: User | null, ... }`); `authApi.changePassword` and `MIN_PASSWORD_LENGTH` from `frontend/src/auth/api.ts` (Task 3).
- Produces: `ProfilePage` component (default export is **not** used anywhere in this codebase's pages — use a named export, matching every other page).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/ProfilePage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
const useAuth = vi.fn();

vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: { changePassword: (a: string, b: string) => changePassword(a, b) },
}));

beforeEach(() => {
  useAuth.mockReturnValue({
    user: {
      id: 'u1',
      email: 'student@example.com',
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
    },
  });
  changePassword.mockReset();
});

describe('ProfilePage', () => {
  test("shows the signed-in user's email and role", () => {
    render(<ProfilePage />);
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  test('submitting calls changePassword, shows a success message, and clears the fields', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-pass-123' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'),
    );
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  test('a rejected current password shows an error and keeps the fields filled in', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ProfilePage.test.tsx`
Expected: FAIL — cannot find module `./ProfilePage`

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/ProfilePage.tsx`:

```tsx
import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-page">
      <h1>Profile</h1>

      <dl className="profile-details">
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>Role</dt>
        <dd>{user?.role}</dd>
      </dl>

      <h2>Change password</h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="auth-form profile-form">
        <div className="auth-fields">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>

        <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>

        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}

        {success && <p className="profile-success">Password changed.</p>}

        <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Working…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

In `frontend/src/App.css`, after the `.import-success` line (currently line 575), add:

```css
.profile-details { margin: 1rem 0 2rem; }
.profile-details dt { font-size: 0.8rem; opacity: 0.65; margin-top: 0.75rem; }
.profile-details dd { margin: 0.15rem 0 0; font-size: 1rem; }
.profile-form { max-width: 24rem; margin-top: 1rem; }
.profile-success { color: var(--success); margin-top: 1rem; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- ProfilePage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ProfilePage.tsx frontend/src/pages/ProfilePage.test.tsx frontend/src/App.css
git commit -m "feat(web): add ProfilePage with a change-password form"
```

---

### Task 5: Frontend — route and account-menu link

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/icons.tsx`
- Modify: `frontend/src/shell/AccountMenu.tsx`
- Modify: `frontend/src/shell/AccountMenu.test.tsx`

**Interfaces:**
- Consumes: `ProfilePage` from Task 4; existing `RequireAuth`/`AppShell` wrapper in `router.tsx`.
- Produces: `UserIcon` component in `icons.tsx` (same `IconProps` shape as every other icon there); `/profile` route reachable from the account menu for every signed-in role.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/shell/AccountMenu.test.tsx` with:

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AccountMenu } from './AccountMenu';

function renderMenu(role: 'user' | 'admin' = 'user') {
  const onLogout = vi.fn();
  render(
    <MemoryRouter>
      <AccountMenu email="tech@example.com" role={role} onLogout={onLogout} />
    </MemoryRouter>,
  );
  return { onLogout };
}

describe('AccountMenu', () => {
  test('the panel starts closed', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Sign out')).not.toBeVisible();
  });

  test('a plain user sees Profile and Sign out but no admin links', () => {
    renderMenu('user');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));

    expect(screen.getByRole('link', { name: 'Profile' })).toBeVisible();
    expect(screen.getByText('Sign out')).toBeVisible();
    expect(screen.queryByText('Admin · Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin · Import')).not.toBeInTheDocument();
  });

  test('Profile comes before Sign out, which comes before the admin links', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));

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
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
    fireEvent.click(screen.getByText('Sign out'));

    expect(onLogout).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking Profile links to /profile and closes the panel', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
    const link = screen.getByRole('link', { name: 'Profile' });
    expect(link).toHaveAttribute('href', '/profile');

    fireEvent.click(link);
    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking an admin link closes the panel', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
    fireEvent.click(screen.getByRole('link', { name: /Admin · Users/ }));

    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd frontend && npm test -- AccountMenu.test.tsx`
Expected: FAIL — no `Profile` link exists yet

- [ ] **Step 3: Add the icon**

In `frontend/src/shell/icons.tsx`, after the `AutoThemeIcon` function (currently ending at line 134) and before the `BY_SLUG` map, add:

```tsx
export function UserIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19.5a7 7 0 0114 0" />
    </svg>
  );
}
```

- [ ] **Step 4: Add the Profile link to the menu**

In `frontend/src/shell/AccountMenu.tsx`:

Update the import line:

```tsx
import { CogIcon, UserIcon } from './icons';
```

Update the doc comment at the top (replace the sentence about a profile page coming later):

```tsx
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
```

Add a `<li>` for Profile as the first item in the panel's `<ul>`, immediately before the existing Sign out `<li>`:

```tsx
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- AccountMenu.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Add the route**

In `frontend/src/router.tsx`, add the import:

```tsx
import { ProfilePage } from './pages/ProfilePage';
```

(Insert it alphabetically among the existing `./pages/...` imports — after `NotFoundPage` and before `QuizPage`.)

Add the route inside the `RequireAuth` + `AppShell` block, after `/courses/:slug/results/:attemptId` and before the `/admin/users` route:

```tsx
<Route path="/courses/:slug/results/:attemptId" element={<ResultsPage />} />
<Route path="/profile" element={<ProfilePage />} />
<Route
  path="/admin/users"
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS (all tests, no regressions)

- [ ] **Step 8: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add frontend/src/router.tsx frontend/src/shell/icons.tsx frontend/src/shell/AccountMenu.tsx frontend/src/shell/AccountMenu.test.tsx
git commit -m "feat(web): route /profile and link it from the account menu"
```

---

## Manual Verification

After all 5 tasks are committed:

1. `npm run dev` from the repo root.
2. Sign in, open the account menu, click **Profile** — confirm email/role show and the page is reachable for a non-admin.
3. Submit the change-password form with the wrong current password — confirm the inline error.
4. Submit it with the correct current password and a valid new password — confirm the success message, then sign out and sign back in with the **new** password.
5. Log in on a second browser (or an incognito window) as the same user, then change the password from the first — confirm the second window's session is dead on its next request (e.g. a page refresh bounces it to the login form).

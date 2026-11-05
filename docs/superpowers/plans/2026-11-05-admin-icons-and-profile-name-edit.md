# Icon Action Buttons + Profile Name Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text role-toggle/delete buttons on the admin users table with icon buttons, and let a signed-in user edit their own first/last name from the Profile page.

**Architecture:** Two independent slices sharing no code. Slice A (Tasks 1-2) adds two icons and CSS, then swaps the admin table's button content from text to icon — the accessible name (`aria-label`) stays identical to today's visible text, so no admin-table test changes are needed. Slice B (Tasks 3-4) adds a `PATCH /api/auth/name` endpoint and a new form on `ProfilePage.tsx`, following the exact pattern the existing `changePassword` flow already uses end-to-end.

**Tech Stack:** Same as the rest of this branch — Express 5, Drizzle ORM, Zod 4 (backend); React 19, Vitest/Testing Library (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-admin-icons-and-profile-name-edit-design.md` — follow it exactly.
- Icon buttons keep their current accessible names ("Make admin", "Make user", "Delete") via `aria-label`/`title` — only the visible content changes. Existing `AdminUsersPage.test.tsx` promote/demote/delete tests must pass unmodified.
- Name edit has no current-password confirmation (not security-sensitive, unlike password change).
- An empty string in the name-edit form clears the field (stored as `null`), not rejected as invalid.
- Work happens on branch `feat/seed-users-import` (already checked out). Commit after every passing step. Conventional Commits with `api`/`web` scope.

---

### Task 1: `TrashIcon` and `UserMinusIcon`, icon-button CSS

**Files:**
- Modify: `frontend/src/shell/icons.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Produces: `TrashIcon({ className }: IconProps)` and `UserMinusIcon({ className }: IconProps)`, exported alongside the file's other icons — Task 2 imports both. `UserIcon` (already exported) is reused for promote, unchanged.
- Produces: CSS classes `.icon-button` and `.icon-button-icon` — Task 2 applies them.

- [ ] **Step 1: Add the two icons**

In `frontend/src/shell/icons.tsx`, add after the existing `UserIcon` function (before `SignOutIcon`):

```tsx
export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M7 7l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** A person with a minus sign: demoting an admin back to a plain user. */
export function UserMinusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M3.5 19.5a6.8 6.8 0 0113 0" />
      <path d="M16.5 12.5h5" />
    </svg>
  );
}
```

There is no test file for `icons.tsx` today (it's purely presentational, matching the file's existing untested icons) — no test step for this file.

- [ ] **Step 2: Add the icon-button CSS**

In `frontend/src/App.css`, find the `.admin-actions` rule (around line 566: `.admin-actions { display: flex; gap: 0.5rem; }`) and add immediately after it:

```css
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  cursor: pointer;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
}
.icon-button:hover { background: var(--accent-bg); border-color: var(--accent-border); }
.icon-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.icon-button:disabled { opacity: 0.5; cursor: not-allowed; }

.icon-button-icon { width: 1.05rem; height: 1.05rem; flex: 0 0 auto; }
```

(This mirrors the existing `.theme-toggle`/`.theme-icon` pattern in the same file.)

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build -w frontend`
Expected: succeeds (no component references the new icons/classes yet, so this just confirms the CSS/icon file edits themselves are syntactically valid).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shell/icons.tsx frontend/src/App.css
git commit -m "feat(web): add trash/user-minus icons and icon-button styles"
```

---

### Task 2: Icon buttons on `AdminUsersPage`

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`

**Interfaces:**
- Consumes: `TrashIcon`, `UserMinusIcon` from Task 1; existing `UserIcon` (already exported from `icons.tsx`, used elsewhere in the app).

No test changes in this task — the spec and global constraints require the accessible names to stay identical, and `AdminUsersPage.test.tsx`'s existing promote/demote/delete tests already query by `aria-label` text (`getByRole('button', { name: /make admin/i })`, etc.), which this task preserves exactly.

- [ ] **Step 1: Run the existing tests to confirm the current baseline**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: PASS (9/9) — this is the baseline before the change, not a TDD red/green cycle (there's no new behavior to test, only new markup for existing behavior).

- [ ] **Step 2: Update the import and the two buttons**

In `frontend/src/pages/admin/AdminUsersPage.tsx`, add to the existing `icons` import — there isn't one yet, so add a new import line alongside the other imports at the top:

```tsx
import { TrashIcon, UserIcon, UserMinusIcon } from '../../shell/icons';
```

Replace the two buttons inside the `<td className="admin-actions">` block:

```tsx
                  <td className="admin-actions">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void toggleRole(u)}
                      aria-label={u.role === 'admin' ? 'Make user' : 'Make admin'}
                      title={u.role === 'admin' ? 'Make user' : 'Make admin'}
                    >
                      {u.role === 'admin' ? (
                        <UserMinusIcon className="icon-button-icon" />
                      ) : (
                        <UserIcon className="icon-button-icon" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={isSelf || busyId === u.id}
                      onClick={() => void remove(u)}
                      aria-label="Delete"
                      title="Delete"
                    >
                      <TrashIcon className="icon-button-icon" />
                    </button>
                  </td>
```

- [ ] **Step 3: Run tests to confirm nothing broke**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: PASS (9/9), unchanged — the accessible names match what the tests already query for.

- [ ] **Step 4: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx
git commit -m "feat(web): show icon buttons for promote/demote/delete on the admin users table"
```

---

### Task 3: Backend — `PATCH /api/auth/name`

**Files:**
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/controllers/auth.controller.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Modify: `backend/src/models/user.model.test.ts`
- Modify: `backend/src/controllers/auth.controller.test.ts`

**Interfaces:**
- Produces: `updateName(id: string, firstName: string | null, lastName: string | null): Promise<PublicUser | null>` in `user.model.ts`.
- Produces: `PATCH /api/auth/name` (requires auth) → `{ user: PublicUser }` — Task 4's frontend depends on this response shape.

- [ ] **Step 1: Write the failing model test**

Add to `backend/src/models/user.model.test.ts`:

```ts
test('updateName sets first and last name', async () => {
  const user = await createUser('rename@example.com', 'hash');
  const updated = await updateName(user!.id, 'Jane', 'Doe');
  assert.equal(updated?.firstName, 'Jane');
  assert.equal(updated?.lastName, 'Doe');
});

test('updateName clears a name back to null', async () => {
  const user = await createUser('clear-name@example.com', 'hash', 'Jane', 'Doe');
  const updated = await updateName(user!.id, null, null);
  assert.equal(updated?.firstName, null);
  assert.equal(updated?.lastName, null);
});
```

Add `updateName` to the existing import line at the top of the file:

```ts
import { createUser, findUserByIdWithHash, updatePasswordHash, updateName } from './user.model.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w backend -- --test-name-pattern "updateName"`
Expected: FAIL — `updateName` is not exported from `user.model.ts` yet.

- [ ] **Step 3: Add `updateName` to `user.model.ts`**

Add after `createUser` (before `findUserByEmailWithHash`):

```ts
/** Used by the profile name-edit form — either field may be cleared to null. */
export async function updateName(
  id: string,
  firstName: string | null,
  lastName: string | null,
): Promise<PublicUser | null> {
  const [user] = await db
    .update(users)
    .set({ firstName, lastName })
    .where(eq(users.id, id))
    .returning(publicColumns);

  return user ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w backend -- --test-name-pattern "updateName"`
Expected: PASS.

- [ ] **Step 5: Write the failing controller tests**

Add to `backend/src/controllers/auth.controller.test.ts`:

```ts
test('PATCH /api/auth/name requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/name updates and returns the user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'name-update@example.com');

  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/auth/name clears a name when given blank strings', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'name-clear@example.com');
  await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: '' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, null);
  assert.equal(body.user.lastName, null);
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm run test -w backend -- --test-name-pattern "auth/name"`
Expected: FAIL — the route doesn't exist yet (404).

- [ ] **Step 7: Add the controller handler**

In `backend/src/controllers/auth.controller.ts`, add the import and handler. Add to the existing `user.model.ts` import:

```ts
import {
  createUser,
  findUserByEmailWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  updateName,
} from '../models/user.model.ts';
```

Add the handler at the end of the file (after `me`):

```ts
const nameBody = z.object({
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
});

/**
 * Updates the signed-in user's first/last name. An omitted or blank field
 * clears that name — unlike the import flow's validation, this is an edit
 * surface where un-setting a name back to blank is a legitimate action.
 * @param req
 * @param res
 */
export async function updateNameHandler(req: Request, res: Response): Promise<void> {
  const parsed = nameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const firstName = parsed.data.firstName === '' || parsed.data.firstName === undefined ? null : parsed.data.firstName;
  const lastName = parsed.data.lastName === '' || parsed.data.lastName === undefined ? null : parsed.data.lastName;

  const user = await updateName(req.user!.id, firstName, lastName);
  res.json({ user });
}
```

- [ ] **Step 8: Wire the route**

In `backend/src/routes/auth.routes.ts`:

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
authRouter.patch('/name', requireAuth, auth.updateNameHandler);
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w backend -- --test-name-pattern "auth/name"`
Expected: PASS for all three cases.

- [ ] **Step 10: Run the full backend suite and typecheck**

Run: `npm run typecheck -w backend && npm run test -w backend`
Expected: everything passes.

- [ ] **Step 11: Commit**

```bash
git add backend/src/models/user.model.ts backend/src/models/user.model.test.ts backend/src/controllers/auth.controller.ts backend/src/controllers/auth.controller.test.ts backend/src/routes/auth.routes.ts
git commit -m "feat(api): add PATCH /auth/name to edit your own first/last name"
```

---

### Task 4: Frontend — Profile "Edit name" form

**Files:**
- Modify: `frontend/src/auth/api.ts`
- Modify: `frontend/src/auth/context.ts`
- Modify: `frontend/src/auth/AuthProvider.tsx`
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/auth/name` from Task 3.
- Produces: `authApi.updateName(firstName: string, lastName: string): Promise<{ user: User }>`; `AuthState.updateUser(user: User): void`.

- [ ] **Step 1: Update the test file's mock and add new tests**

In `frontend/src/pages/ProfilePage.test.tsx`, update the mocks at the top:

```ts
const changePassword = vi.fn();
const updateName = vi.fn();
const updateUser = vi.fn();
const useAuth = vi.fn();

vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuth() }));
vi.mock('../auth/api', () => ({
  MIN_PASSWORD_LENGTH: 8,
  authApi: {
    changePassword: (a: string, b: string) => changePassword(a, b),
    updateName: (a: string, b: string) => updateName(a, b),
  },
}));
```

Update `beforeEach` to include `firstName`/`lastName` on the mock user and the new `updateUser` function in `useAuth`'s return value, and reset `updateName`:

```ts
beforeEach(() => {
  useAuth.mockReturnValue({
    user: {
      id: 'u1',
      email: 'student@example.com',
      firstName: null,
      lastName: null,
      role: 'user',
      createdAt: '2026-11-01T00:00:00Z',
    },
    updateUser,
  });
  changePassword.mockReset();
  updateName.mockReset();
  updateUser.mockReset();
});
```

The existing `'shows the Role row for an admin'` test's own `useAuth.mockReturnValue(...)` call does not strictly need `firstName`/`lastName`/`updateUser` added — that test never submits the name form, so `updateUser` is never called and the missing fields are never read. Leave it as-is unless you want the mock shape consistent across tests for readability; either way is correct.

Add two new tests, after the existing `'a rejected current password...'` test:

```ts
  test('editing your name calls updateName and updates the cached user', async () => {
    updateName.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'student@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'user',
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    render(<ProfilePage />);

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /save name/i }));

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('Jane', 'Doe'));
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      ),
    );
    expect(await screen.findByText('Name updated.')).toBeInTheDocument();
  });

  test('a failed name update shows an error', async () => {
    updateName.mockRejectedValue(new Error('Something went wrong'));
    render(<ProfilePage />);

    fireEvent.click(screen.getByRole('button', { name: /save name/i }));

    expect(await screen.findAllByRole('alert')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w frontend -- ProfilePage.test.tsx`
Expected: FAIL — no "First name"/"Last name" inputs or "Save name" button exist yet, and `useAuth`'s mock return value doesn't yet matter since the component doesn't read `updateUser`.

- [ ] **Step 3: Add `updateName` to `auth/api.ts`**

```ts
  updateName: (firstName: string, lastName: string) =>
    request<{ user: User }>('/auth/name', {
      method: 'PATCH',
      body: JSON.stringify({ firstName, lastName }),
    }),
```

Add this inside the `authApi` object, after `changePassword`.

- [ ] **Step 4: Add `updateUser` to `AuthState`**

In `frontend/src/auth/context.ts`:

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

- [ ] **Step 5: Implement `updateUser` in `AuthProvider.tsx`**

Add after the existing `logout` callback:

```tsx
  const updateUser = useCallback((updated: User) => {
    setUser(updated);
  }, []);
```

Add `updateUser` to the `value` memo's dependency array and object:

```tsx
  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, updateUser }),
    [user, loading, login, register, logout, updateUser],
  );
```

- [ ] **Step 6: Add the "Edit name" section to `ProfilePage.tsx`**

Replace the full contents of `frontend/src/pages/ProfilePage.tsx`:

```tsx
import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSubmitting, setNameSubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleNameSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setNameSuccess(false);
    setNameSubmitting(true);
    try {
      const { user: updated } = await authApi.updateName(firstName, lastName);
      updateUser(updated);
      setNameSuccess(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setNameSubmitting(false);
    }
  }

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
        {user?.role === 'admin' && (
          <>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </>
        )}
      </dl>

      <h2>Edit name</h2>
      <form onSubmit={(e) => void handleNameSubmit(e)} className="auth-form profile-form">
        <div className="auth-fields">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            aria-label="First name"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            aria-label="Last name"
          />
        </div>

        {nameError && (
          <p role="alert" className="auth-error">
            {nameError}
          </p>
        )}

        {nameSuccess && <p className="profile-success">Name updated.</p>}

        <button type="submit" className="auth-submit" disabled={nameSubmitting} aria-busy={nameSubmitting}>
          {nameSubmitting ? 'Working…' : 'Save name'}
        </button>
      </form>

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

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w frontend -- ProfilePage.test.tsx`
Expected: PASS for all cases, including the pre-existing password-change tests (the "a rejected current password shows an error" test asserts exactly one `role="alert"` via `findByRole('alert')`, which still holds since the name form's `nameError` is independently `null` in that test).

- [ ] **Step 8: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; build succeeds (confirms `AuthState`'s new required `updateUser` field doesn't break any other `useAuth()` consumer — check the build output for any TS error outside the files this task touched; if one appears in another component that destructures `useAuth()`, that component only needs the mock/real context to supply `updateUser`, which `AuthProvider` now always does, so no other file should actually need edits).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/auth/api.ts frontend/src/auth/context.ts frontend/src/auth/AuthProvider.tsx frontend/src/pages/ProfilePage.tsx frontend/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): add an Edit name form to the Profile page"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `npm run test`
Expected: both workspaces pass.

- [ ] **Step 2: Report back**

No commit for this task.

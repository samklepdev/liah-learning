# Remove Profile Name Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the self-service ability for a logged-in user to edit their own first/last name, leaving it permanently read-only, while keeping self-service password changes working.

**Architecture:** Two independent layers, each removed top-down (UI/API client first, then route/controller/model), with their test suites updated to match in the same task. No DB schema change.

**Tech Stack:** React + Vitest + Testing Library (frontend); Express + Zod + Drizzle + Node's built-in test runner (backend).

## Global Constraints

- No DB schema/migration change — `firstName`/`lastName` stay nullable, set once at creation by `createUser`, never written again.
- Admin user-management screens and routes are untouched — out of scope, no existing edit-name capability there to remove.
- Username derivation/regeneration logic is untouched.
- Password change behavior (validation: both fields filled or both blank, session handling) must keep working exactly as today.

---

### Task 1: Frontend — read-only name, password-only profile form

**Files:**
- Modify: `frontend/src/pages/ProfilePage.tsx` (full rewrite)
- Modify: `frontend/src/auth/api.ts:42-46` (remove `updateName`)
- Test: `frontend/src/pages/ProfilePage.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `authApi.changePassword(currentPassword: string, newPassword: string): Promise<void>` (unchanged, from `frontend/src/auth/api.ts`); `useAuth(): { user: User | null }` (no longer needs `updateUser` from this page).
- Produces: `ProfilePage` component with no name-editing UI and no `authApi.updateName` import anywhere in the frontend.

- [ ] **Step 1: Write the failing test file**

Replace the entire contents of `frontend/src/pages/ProfilePage.test.tsx` with:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

const changePassword = vi.fn();
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
  });
}

function openPasswordForm() {
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
}

beforeEach(() => {
  mockUser();
  changePassword.mockReset();
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

  test('displays the current first and last name with no way to edit them', () => {
    mockUser({ firstName: 'Jane', lastName: 'Doe' });
    render(<ProfilePage />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit profile/i })).not.toBeInTheDocument();
  });

  test('clicking Change password reveals the password form, with no name inputs anywhere', () => {
    render(<ProfilePage />);
    openPasswordForm();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last name')).not.toBeInTheDocument();
  });

  test('Cancel discards password edits and hides the form without any network calls', () => {
    render(<ProfilePage />);
    openPasswordForm();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'something' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('only one password field filled shows a validation error and does not call the API', async () => {
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(
      await screen.findByText('Enter both current and new password to change it.'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('saving with both password fields filled calls changePassword and hides the form', async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass-123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pass-123', 'new-pass-456'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Password updated.'));
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  test('a failed password change keeps the form open and shows the error', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ProfilePage />);
    openPasswordForm();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('wrong-pass');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/pages/ProfilePage.test.tsx`
Expected: FAIL — the current component still has an "Edit profile" button, name inputs, and no "Change password"/"Save password" buttons, so most of the new assertions don't match.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `frontend/src/pages/ProfilePage.tsx` with:

```tsx
import { useState, type SubmitEvent } from 'react';
import toast from 'react-hot-toast';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user } = useAuth();

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function startChangingPassword() {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setIsChangingPassword(true);
  }

  function cancelChangingPassword() {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setIsChangingPassword(false);
  }

  async function handleChangePassword(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError(null);

    const bothFilled = currentPassword !== '' && newPassword !== '';
    if (!bothFilled) {
      setPasswordError('Enter both current and new password to change it.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setIsChangingPassword(false);
      toast.success('Password updated.');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>

      <dl className="profile-details">
        <dt>First name</dt>
        <dd>{user?.firstName ?? '—'}</dd>
        <dt>Last name</dt>
        <dd>{user?.lastName ?? '—'}</dd>
        <dt>Username</dt>
        <dd>{user?.username}</dd>
        {user?.role === 'admin' && (
          <>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </>
        )}
      </dl>

      {!isChangingPassword && (
        <button type="button" className="auth-submit" onClick={startChangingPassword}>
          Change password
        </button>
      )}

      {isChangingPassword && (
        <form onSubmit={(e) => void handleChangePassword(e)} className="auth-form profile-form">
          <div className="auth-fields">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              aria-label="Current password"
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

          <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>

          {passwordError && (
            <p role="alert" className="auth-error">
              {passwordError}
            </p>
          )}

          <div className="profile-actions">
            <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? 'Working…' : 'Save password'}
            </button>
            <button
              type="button"
              className="auth-submit auth-submit-secondary"
              disabled={submitting}
              onClick={cancelChangingPassword}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Remove `updateName` from the API client**

In `frontend/src/auth/api.ts`, delete lines 42-46:

```ts
  updateName: (firstName: string, lastName: string) =>
    request<{ user: User }>('/auth/name', {
      method: 'PATCH',
      body: JSON.stringify({ firstName, lastName }),
    }),

```

(Delete the whole block, including its trailing blank line, so `changePassword` is immediately followed by `logout` in the `authApi` object.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test -- src/pages/ProfilePage.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ProfilePage.tsx frontend/src/pages/ProfilePage.test.tsx frontend/src/auth/api.ts
git commit -m "feat(profile): remove self-service name editing, keep password change"
```

---

### Task 2: Backend — remove the `PATCH /auth/name` endpoint

**Files:**
- Modify: `backend/src/routes/auth.routes.ts:12` (remove route registration)
- Modify: `backend/src/controllers/auth.controller.ts:17` (remove `updateName` import), `:153-156` (remove `nameBody` schema), `:158-188` (remove `updateNameHandler`)
- Modify: `backend/src/models/user.model.ts:60-78` (remove `updateName` function)
- Modify: `backend/src/controllers/auth.controller.test.ts:112-201` (remove the `PATCH /api/v1/auth/name` test block)
- Modify: `backend/src/models/user.model.test.ts:10` (remove `updateName` import), `:91-117` (remove the `updateName` test block)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — this task only removes dead code and its tests. No other file in the backend imports `updateName` or references `/auth/name` (confirmed during spec research).

- [ ] **Step 1: Remove the route**

In `backend/src/routes/auth.routes.ts`, delete line 12:

```ts
authRouter.patch('/name', requireAuth, auth.updateNameHandler);
```

So the file ends with `authRouter.patch('/password', requireAuth, auth.changePassword);`.

- [ ] **Step 2: Remove the controller handler and schema**

In `backend/src/controllers/auth.controller.ts`:

1. Change the import block (lines 12-19) from:

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

to:

```ts
import {
  createUser,
  findUserByUsernameWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  clearMustChangePassword,
} from '../models/user.model.ts';
```

2. Delete the `nameBody` schema and `updateNameHandler` function (lines 153-188 — everything from `const nameBody = ...` through the closing `}` of `updateNameHandler`), so the file ends with the `me` function (lines 149-151).

- [ ] **Step 3: Remove the model function**

In `backend/src/models/user.model.ts`, delete the `updateName` function and its doc comment (lines 60-78):

```ts
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

```

- [ ] **Step 4: Remove the obsolete controller test block**

In `backend/src/controllers/auth.controller.test.ts`, delete the six tests from `PATCH /api/v1/auth/name requires a session` through the end of `PATCH /api/v1/auth/name with an empty body leaves both names unchanged` (lines 112-201), including their blank-line separators, so the file goes directly from the end of the `PATCH /api/v1/auth/password changes the password...` test (line 110) to `POST /api/v1/auth/register rejects a missing first or last name` (line 203).

- [ ] **Step 5: Remove the obsolete model test block**

In `backend/src/models/user.model.test.ts`:

1. Remove `updateName` from the import block (line 10), so it reads:

```ts
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  clearMustChangePassword,
  INITIAL_PASSWORD,
} from './user.model.ts';
```

2. Delete the four `updateName` tests (lines 91-117 — from `test('updateName sets first and last name', ...)` through the end of `test('updateName with no keys leaves both names untouched...')`), so the file goes directly from `createUser stores first/last name and role` to `createUser persists mustChangePassword`.

- [ ] **Step 6: Run the backend test suite**

Run: `cd backend && npm test`
Expected: PASS, with no reference to `/auth/name` or `updateName` remaining anywhere in `backend/src`. (Confirm with `grep -rn "updateName\|auth/name" backend/src` — expected: no output.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/auth.routes.ts backend/src/controllers/auth.controller.ts backend/src/models/user.model.ts backend/src/controllers/auth.controller.test.ts backend/src/models/user.model.test.ts
git commit -m "feat(auth): remove PATCH /auth/name endpoint and updateName model fn"
```

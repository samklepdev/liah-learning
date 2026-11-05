# Profile Combined Name + Password Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ProfilePage's two always-visible forms (name, password) with a
read-only display plus a single "Edit profile" toggle that reveals one combined
edit form, saved with one "Save profile" button.

**Architecture:** Entirely frontend, no backend changes — reuses the existing
`authApi.updateName`/`authApi.changePassword` endpoints, fired concurrently from
one save handler, each tracked independently so one failing doesn't block or
discard the other's success. Single `ProfilePage` component with an `isEditing`
boolean switching between a read-only `<dl>` view and an edit `<form>` view.

**Tech Stack:** Same as the rest of this branch — React 19, Vitest/Testing Library
(frontend only for this plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-05-profile-combined-edit-design.md` — follow it exactly.
- No backend changes. Reuse `authApi.updateName(firstName: string, lastName: string): Promise<{ user: User }>` and `authApi.changePassword(currentPassword: string, newPassword: string): Promise<void>` exactly as already defined in `frontend/src/auth/api.ts` — do not modify that file.
- Password fields are optional: both blank skips the password change; exactly one filled is a validation error; both filled attempts the change.
- The name call and the password call (if attempted) fire concurrently — one failing must not block or skip the other.
- On full success: update the cached user, exit edit mode, show "Profile updated." on the read-only view.
- On partial failure: apply whichever call succeeded, stay in edit mode, show each failing call's error next to its own fields, leave the user's typed values in place.
- Work happens on branch `feat/seed-users-import` (already checked out). Commit after every passing step. Conventional Commits with `web` scope.

## File Structure

- `frontend/src/App.css` — add two new classes: `.profile-actions` (flex row for Save/Cancel) and `.auth-submit-secondary` (bordered/transparent modifier for Cancel), reusing existing design tokens.
- `frontend/src/pages/ProfilePage.tsx` — full rewrite: read-only `<dl>` view (First name, Last name, Email, Role) + "Edit profile" button when `!isEditing`; combined edit `<form>` (name + password fields, Save profile + Cancel) when `isEditing`.
- `frontend/src/pages/ProfilePage.test.tsx` — full rewrite to match the new interaction flow.

---

### Task 1: CSS for the secondary button and action row

**Files:**
- Modify: `frontend/src/App.css`

**Interfaces:**
- Produces: CSS classes `.profile-actions` and `.auth-submit-secondary` — Task 2 applies them.

- [ ] **Step 1: Add the CSS**

In `frontend/src/App.css`, find the `.profile-success` rule (around line 600:
`.profile-success { color: var(--success); margin-top: 1rem; }`) and add
immediately after it:

```css
.profile-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.profile-actions .auth-submit {
  width: auto;
  flex: 1;
}

.auth-submit-secondary {
  background: transparent;
  color: inherit;
  border: 1px solid var(--border);
}

.auth-submit-secondary:hover:not(:disabled) {
  background: var(--accent-bg);
  filter: none;
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build -w frontend`
Expected: succeeds (no component references these classes yet, so this just
confirms the CSS edit is syntactically valid).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(web): add secondary button and action-row styles for profile editing"
```

---

### Task 2: Rewrite ProfilePage for combined edit mode

**Files:**
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `.profile-actions`, `.auth-submit-secondary` from Task 1; `authApi.updateName`, `authApi.changePassword`, `MIN_PASSWORD_LENGTH` from `../auth/api` (all pre-existing, unchanged); `useAuth` from `../auth/useAuth`, which returns `{ user: User | null, updateUser: (user: User) => void }` (both pre-existing, unchanged).

This task replaces an existing, working feature wholesale rather than adding new
behavior behind a flag, so it's done as one full-file rewrite per file rather than
incremental red/green steps: replace the test file first, confirm it fails against
the *old* component, then replace the component and confirm the new test file
passes.

- [ ] **Step 1: Replace the full contents of `ProfilePage.test.tsx`**

Replace the full contents of `frontend/src/pages/ProfilePage.test.tsx` with:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

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
      email: 'student@example.com',
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
});

describe('ProfilePage', () => {
  test('shows the email and em-dash name fields, but not a Role row, for a plain user', () => {
    render(<ProfilePage />);
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
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
        email: 'student@example.com',
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
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  test('saving with both name and password filled calls both APIs and returns to read-only view', async () => {
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
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
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
        email: 'student@example.com',
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
        email: 'student@example.com',
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w frontend -- ProfilePage.test.tsx`
Expected: FAIL — the old component has no "Edit profile" button, no "Save profile"
button, and renders both forms unconditionally, so most of these queries won't
find what they expect.

- [ ] **Step 3: Replace the full contents of `ProfilePage.tsx`**

Replace the full contents of `frontend/src/pages/ProfilePage.tsx` with:

```tsx
import { useState, type SubmitEvent } from 'react';
import { authApi, MIN_PASSWORD_LENGTH } from '../auth/api';
import { useAuth } from '../auth/useAuth';

export function ProfilePage() {
  const { user, updateUser } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  function startEditing() {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
    setCurrentPassword('');
    setNewPassword('');
    setNameError(null);
    setPasswordError(null);
    setJustSaved(false);
    setIsEditing(true);
  }

  function cancelEditing() {
    setCurrentPassword('');
    setNewPassword('');
    setNameError(null);
    setPasswordError(null);
    setIsEditing(false);
  }

  async function handleSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setPasswordError(null);

    const bothPasswordFieldsFilled = currentPassword !== '' && newPassword !== '';
    const onePasswordFieldFilled = (currentPassword !== '') !== (newPassword !== '');
    if (onePasswordFieldFilled) {
      setPasswordError('Enter both current and new password to change it, or leave both blank.');
      return;
    }

    setSubmitting(true);
    const [nameResult, passwordResult] = await Promise.allSettled([
      authApi.updateName(firstName, lastName),
      bothPasswordFieldsFilled
        ? authApi.changePassword(currentPassword, newPassword)
        : Promise.resolve(null),
    ]);
    setSubmitting(false);

    let nameOk = false;
    if (nameResult.status === 'fulfilled') {
      updateUser(nameResult.value.user);
      nameOk = true;
    } else {
      setNameError(nameResult.reason instanceof Error ? nameResult.reason.message : 'Something went wrong');
    }

    let passwordOk = true;
    if (bothPasswordFieldsFilled) {
      if (passwordResult.status === 'fulfilled') {
        passwordOk = true;
      } else {
        passwordOk = false;
        setPasswordError(
          passwordResult.reason instanceof Error ? passwordResult.reason.message : 'Something went wrong',
        );
      }
    }

    if (nameOk && passwordOk) {
      setCurrentPassword('');
      setNewPassword('');
      setIsEditing(false);
      setJustSaved(true);
    }
  }

  if (!isEditing) {
    return (
      <div className="admin-page">
        <h1>Profile</h1>

        <dl className="profile-details">
          <dt>First name</dt>
          <dd>{user?.firstName ?? '—'}</dd>
          <dt>Last name</dt>
          <dd>{user?.lastName ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{user?.email}</dd>
          {user?.role === 'admin' && (
            <>
              <dt>Role</dt>
              <dd>{user.role}</dd>
            </>
          )}
        </dl>

        {justSaved && <p className="profile-success">Profile updated.</p>}

        <button type="button" className="auth-submit" onClick={startEditing}>
          Edit profile
        </button>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1>Profile</h1>

      <form onSubmit={(e) => void handleSave(e)} className="auth-form profile-form">
        <div className="auth-fields">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            aria-label="First name"
            autoComplete="given-name"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            aria-label="Last name"
            autoComplete="family-name"
          />
        </div>

        {nameError && (
          <p role="alert" className="auth-error">
            {nameError}
          </p>
        )}

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

        <p className="auth-hint">
          Leave password fields blank to keep your current password. At least {MIN_PASSWORD_LENGTH}{' '}
          characters.
        </p>

        {passwordError && (
          <p role="alert" className="auth-error">
            {passwordError}
          </p>
        )}

        <div className="profile-actions">
          <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Working…' : 'Save profile'}
          </button>
          <button
            type="button"
            className="auth-submit auth-submit-secondary"
            disabled={submitting}
            onClick={cancelEditing}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w frontend -- ProfilePage.test.tsx`
Expected: PASS for all 11 cases.

- [ ] **Step 5: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ProfilePage.tsx frontend/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): combine profile name and password editing into one edit mode"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `npm run test`
Expected: both workspaces pass.

- [ ] **Step 2: Report back**

No commit for this task.

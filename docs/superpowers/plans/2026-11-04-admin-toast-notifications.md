# Admin Toast Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin a success toast when deleting a user or confirming a bulk user import — both currently succeed silently.

**Architecture:** `react-hot-toast` mounted once at the app root (`main.tsx`) so `toast()` is callable anywhere; two new `toast.success(...)` calls added to `AdminUsersPage.tsx`'s existing `remove` and `confirmImport` handlers, right after their respective API calls succeed. No other behavior changes.

**Tech Stack:** React 19, Vitest/Testing Library (frontend only — no backend changes in this plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-admin-toast-notifications-design.md` — follow it exactly.
- Toasts are additive (success only). Existing inline `role="alert"` error text on `AdminUsersPage.tsx` is untouched.
- The promote/demote role action gets no toast (not requested) — stays silent-on-success.
- The import results panel (created/skipped tables) stays as-is — the toast is a summary in addition to it, not a replacement.
- Work happens on branch `feat/seed-users-import` (already checked out; this feature depends on `confirmUserImport`, which only exists on this branch). Commit after every passing step. Conventional Commits with `web` scope.

---

### Task 1: Add `react-hot-toast` and mount `<Toaster />`

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: `toast` (default export of `react-hot-toast`) becomes callable from any component — Task 2 depends on this.

- [ ] **Step 1: Install the dependency**

Run: `npm install react-hot-toast -w frontend`
Expected: `frontend/package.json` dependencies gain `"react-hot-toast"`; lockfile updates.

- [ ] **Step 2: Mount the Toaster**

Replace the full contents of `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
  </StrictMode>,
)
```

- [ ] **Step 3: Verify the app still builds and runs**

Run: `npm run build -w frontend`
Expected: succeeds, no TypeScript errors.

Run: `npm run test -w frontend`
Expected: all existing tests still pass (no test currently covers `main.tsx` directly, so this just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx
git commit -m "chore(web): add react-hot-toast and mount Toaster"
```

---

### Task 2: Success toasts on delete and import confirm

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `toast` from `react-hot-toast` (Task 1).

- [ ] **Step 1: Add the mock and two assertions to the test file**

In `frontend/src/pages/admin/AdminUsersPage.test.tsx`, add near the other `vi.mock` calls at the top:

```ts
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message) },
}));
```

Add `toastSuccess.mockReset();` to the existing `beforeEach`, alongside the other `.mockReset()` calls.

In the existing `'deleting a user calls deleteUser and removes the row'` test, add after the existing assertions:

```ts
    expect(toastSuccess).toHaveBeenCalledWith('User deleted');
```

In the existing `'confirming an import shows generated passwords and reloads the user list'` test, add after the existing assertions:

```ts
    expect(toastSuccess).toHaveBeenCalledWith('1 user created');
```

(The mocked `confirmUserImport` response in that test already resolves with exactly one `created` user and an empty `skipped` array — see the existing `confirmUserImport.mockResolvedValue(...)` a few lines above — so the singular, no-skipped-clause form is the correct expected string.)

Add one new test, right after the `'confirming an import...'` test, covering the pluralized-with-skips case:

```ts
  test('a mixed import summarizes created and skipped counts in the toast', async () => {
    parseUserImport.mockResolvedValue({
      rows: [
        { row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' },
        { row: 3, firstName: 'John', lastName: 'Roe', email: 'john@example.com', role: 'user' },
      ],
      errors: [],
    });
    confirmUserImport.mockResolvedValue({
      created: [
        { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' },
      ],
      skipped: [{ email: 'john@example.com', reason: 'already registered' }],
    });
    render(<AdminUsersPage />);
    await screen.findByText('admin@example.com');

    selectImportFile();
    fireEvent.click(screen.getByRole('button', { name: /parse/i }));
    await screen.findByRole('button', { name: /confirm import/i });

    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 user created, 1 skipped'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: FAIL — `toastSuccess` is never called because the component doesn't import or call `toast` yet.

- [ ] **Step 3: Implement**

In `frontend/src/pages/admin/AdminUsersPage.tsx`:

Add the import, alongside the existing ones:

```tsx
import toast from 'react-hot-toast';
```

Add a small helper above the component (or inline — keep it a plain function, not exported, since nothing else needs it):

```tsx
function importSummary(created: number, skipped: number): string {
  const createdPart = `${created} user${created === 1 ? '' : 's'} created`;
  return skipped > 0 ? `${createdPart}, ${skipped} skipped` : createdPart;
}
```

In `remove`, add the toast right after the successful delete, before the state update (or after — order doesn't matter functionally, but keep it next to the line it's narrating):

```tsx
  const remove = async (target: AdminUser) => {
    setBusyId(target.id);
    try {
      await adminApi.deleteUser(target.id);
      toast.success('User deleted');
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  };
```

In `confirmImport`, add the toast right after `results` is obtained:

```tsx
  const confirmImport = async () => {
    if (parsedRows.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const results = await adminApi.confirmUserImport(parsedRows);
      toast.success(importSummary(results.created.length, results.skipped.length));
      setImportResults(results);
      setParsedRows([]);
      setParseErrors([]);
      setImportFile(null);
      load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };
```

No other part of the file changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w frontend -- AdminUsersPage.test.tsx`
Expected: PASS for all cases, including the pre-existing promote/delete/import tests and the three toast assertions (delete, singular-created, mixed-created-and-skipped).

- [ ] **Step 5: Run the full frontend suite and build**

Run: `npm run test -w frontend && npm run build -w frontend`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(web): show a success toast on user delete and import confirm"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite from the repo root**

Run: `npm run test`
Expected: both workspaces pass.

- [ ] **Step 2: Report back**

No commit for this task.

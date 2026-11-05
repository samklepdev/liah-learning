# Admin: View User Attempts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin expand a row on the Users page to see that user's quiz attempts/grades, with a modal for the full history when there are more than 5.

**Architecture:** Backend and the `adminApi` client already expose `GET /admin/users/:id/attempts` via `adminApi.getUserAttempts(id)` — no backend work. All changes are in the frontend: a new shared `AttemptsTable` presentational component, a new `UserAttemptsModal`, and additions to `AdminUsersPage` for expand/collapse state, lazy-fetch-with-cache, and modal wiring.

**Tech Stack:** React + TypeScript, Vitest + React Testing Library, plain CSS (no component library).

## Global Constraints

- No backend changes — `backend/src/models/admin-attempt.model.ts`, `admin-users.controller.ts`, and `admin.routes.ts` are already correct.
- Reuse `adminApi.getUserAttempts` and the `AdminAttempt` type from `frontend/src/admin/api.ts` as-is.
- Inline expansion shows at most the 5 most recent attempts (already newest-first from the backend); a "View all N attempts" control appears only when there are more than 5.
- The full-history view is a modal (first modal component in this app) — introduce `admin-modal*` CSS classes, no new dependency.
- Reuse the existing `.admin-table` class for attempt tables, and the existing `.icon-button` class for toggle/close buttons.
- Follow the existing chevron-rotate pattern (`SidebarNav.tsx` / `.nav-chevron.open`) for the expand toggle, using the existing `ChevronRightIcon`.

---

### Task 1: `AttemptsTable` shared presentational component

**Files:**
- Create: `frontend/src/pages/admin/AttemptsTable.tsx`
- Test: `frontend/src/pages/admin/AttemptsTable.test.tsx`

**Interfaces:**
- Consumes: `AdminAttempt` type from `frontend/src/admin/api.ts` (`{ id: string; courseTitle: string; courseSlug: string; subjectSlug: string; score: number | null; startedAt: string; submittedAt: string | null }`).
- Produces: `AttemptsTable({ attempts }: { attempts: AdminAttempt[] })` — a React component rendering a `<table className="admin-table">` with columns Subject / Course / Score / Status / Date. Used by both `AdminUsersPage` (Task 3) and `UserAttemptsModal` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/AttemptsTable.test.tsx`:

```tsx
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttemptsTable } from './AttemptsTable';
import type { AdminAttempt } from '../../admin/api';

const completed: AdminAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
};

const inProgress: AdminAttempt = {
  id: 'a2',
  courseTitle: 'Water Safety',
  courseSlug: 'water-safety',
  subjectSlug: 'first-aid',
  score: null,
  startedAt: '2026-10-02T00:00:00Z',
  submittedAt: null,
};

describe('AttemptsTable', () => {
  test('renders a row per attempt with subject, course, score, status, and date', () => {
    render(<AttemptsTable attempts={[completed, inProgress]} />);

    expect(screen.getByText('CPR Basics')).toBeInTheDocument();
    expect(screen.getByText('Water Safety')).toBeInTheDocument();
    expect(screen.getAllByText('first-aid')).toHaveLength(2);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-10-01T01:00:00Z').toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-10-02T00:00:00Z').toLocaleDateString())).toBeInTheDocument();
  });

  test('shows a dash for score when the attempt has not been submitted', () => {
    render(<AttemptsTable attempts={[inProgress]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/AttemptsTable.test.tsx`
Expected: FAIL with a module-not-found error for `./AttemptsTable`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/admin/AttemptsTable.tsx`:

```tsx
import type { AdminAttempt } from '../../admin/api';

function formatScore(attempt: AdminAttempt): string {
  return attempt.submittedAt ? String(attempt.score ?? 0) : '—';
}

function formatStatus(attempt: AdminAttempt): string {
  return attempt.submittedAt ? 'Completed' : 'In progress';
}

function formatDate(attempt: AdminAttempt): string {
  return new Date(attempt.submittedAt ?? attempt.startedAt).toLocaleDateString();
}

export function AttemptsTable({ attempts }: { attempts: AdminAttempt[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Course</th>
          <th>Score</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td>{attempt.subjectSlug}</td>
            <td>{attempt.courseTitle}</td>
            <td>{formatScore(attempt)}</td>
            <td>{formatStatus(attempt)}</td>
            <td>{formatDate(attempt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/AttemptsTable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AttemptsTable.tsx frontend/src/pages/admin/AttemptsTable.test.tsx
git commit -m "feat(admin): add AttemptsTable component for displaying user attempts"
```

---

### Task 2: `UserAttemptsModal` full-history modal

**Files:**
- Create: `frontend/src/pages/admin/UserAttemptsModal.tsx`
- Test: `frontend/src/pages/admin/UserAttemptsModal.test.tsx`
- Modify: `frontend/src/App.css` (add modal styles)

**Interfaces:**
- Consumes: `AttemptsTable` from Task 1 (`AttemptsTable({ attempts: AdminAttempt[] })`); `AdminAttempt` type from `frontend/src/admin/api.ts`.
- Produces: `UserAttemptsModal({ userLabel, attempts, onClose }: { userLabel: string; attempts: AdminAttempt[]; onClose: () => void })` — used by `AdminUsersPage` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/UserAttemptsModal.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserAttemptsModal } from './UserAttemptsModal';
import type { AdminAttempt } from '../../admin/api';

const attempt: AdminAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
};

describe('UserAttemptsModal', () => {
  test('renders the full attempt list and the user label', () => {
    render(
      <UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
    expect(screen.getByText('CPR Basics')).toBeInTheDocument();
  });

  test('clicking the close button calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking the overlay calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('admin-modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the modal panel does not call onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.click(screen.getByText('CPR Basics'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('pressing Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<UserAttemptsModal userLabel="jane@example.com" attempts={[attempt]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/UserAttemptsModal.test.tsx`
Expected: FAIL with a module-not-found error for `./UserAttemptsModal`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/admin/UserAttemptsModal.tsx`:

```tsx
import { useEffect } from 'react';
import { AttemptsTable } from './AttemptsTable';
import type { AdminAttempt } from '../../admin/api';

type Props = {
  userLabel: string;
  attempts: AdminAttempt[];
  onClose: () => void;
};

export function UserAttemptsModal({ userLabel, attempts, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="admin-modal-overlay" data-testid="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>{userLabel}&rsquo;s attempts</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="admin-modal-body">
          <AttemptsTable attempts={attempts} />
        </div>
      </div>
    </div>
  );
}
```

Add to `frontend/src/App.css`, after the `.icon-button-icon` rule (around line 575):

```css
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.admin-modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  max-width: 40rem;
  width: 90%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.admin-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

.admin-modal-header h2 { font-size: 1.1rem; margin: 0; }

.admin-modal-body {
  padding: 0 1.25rem 1.25rem;
  overflow-y: auto;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/UserAttemptsModal.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/UserAttemptsModal.tsx frontend/src/pages/admin/UserAttemptsModal.test.tsx frontend/src/App.css
git commit -m "feat(admin): add UserAttemptsModal for full attempt history"
```

---

### Task 3: Row expansion with lazy fetch + cache on `AdminUsersPage`

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`
- Modify: `frontend/src/App.css` (chevron rotate + expanded row)

**Interfaces:**
- Consumes: `AttemptsTable` from Task 1; `adminApi.getUserAttempts(id): Promise<{ attempts: AdminAttempt[] }>` and `AdminAttempt` type (already in `frontend/src/admin/api.ts`); `ChevronRightIcon` from `frontend/src/shell/icons.tsx`.
- Produces: `AdminUsersPage` gains state `expandedId: string | null`, `attemptsById: Record<string, AdminAttempt[]>`, `attemptsLoading: string | null`, `attemptsError: string | null`, and a `toggleAttempts(target: AdminUser): Promise<void>` handler — all consumed internally; Task 4 extends this same component so it reads these same state names.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/admin/AdminUsersPage.test.tsx`, a new `sampleAttempt` constant near the top (after the `toastSuccess` mock block) and new tests in the existing `describe('AdminUsersPage', ...)` block:

```tsx
const sampleAttempt = {
  id: 'a1',
  courseTitle: 'CPR Basics',
  courseSlug: 'cpr-basics',
  subjectSlug: 'first-aid',
  score: 8,
  startedAt: '2026-10-01T00:00:00Z',
  submittedAt: '2026-10-01T01:00:00Z',
};
```

```tsx
  test('expanding a row fetches and shows the user\'s attempts, collapsing hides them', async () => {
    getUserAttempts.mockResolvedValue({ attempts: [sampleAttempt] });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await waitFor(() => expect(getUserAttempts).toHaveBeenCalledWith('u2'));
    expect(await screen.findByText('CPR Basics')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();

    fireEvent.click(within(studentRow).getByRole('button', { name: /hide attempts/i }));
    expect(screen.queryByText('CPR Basics')).not.toBeInTheDocument();
  });

  test('re-expanding a row reuses the cached attempts instead of refetching', async () => {
    getUserAttempts.mockResolvedValue({ attempts: [sampleAttempt] });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    await screen.findByText('CPR Basics');
    fireEvent.click(within(studentRow).getByRole('button', { name: /hide attempts/i }));
    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('CPR Basics');
    expect(getUserAttempts).toHaveBeenCalledTimes(1);
  });

  test('shows "No attempts yet." for a user with no attempts', async () => {
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('No attempts yet.')).toBeInTheDocument();
  });

  test('shows an error message when fetching attempts fails', async () => {
    getUserAttempts.mockRejectedValue(new Error('Network error'));
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: FAIL — no "View attempts" button exists yet, so `getByRole('button', { name: /view attempts/i })` throws.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/admin/AdminUsersPage.tsx`:

Add imports:

```tsx
import {
  adminApi,
  type AdminAttempt,
  type AdminUser,
  type ConfirmedUser,
  type ImportedUserRow,
  type ImportRowError,
  type SkippedUser,
} from '../../admin/api';
import { ChevronRightIcon, TrashIcon, UserIcon, UserMinusIcon } from '../../shell/icons';
import { AttemptsTable } from './AttemptsTable';
```

Add state inside `AdminUsersPage`, alongside the existing `busyId` state:

```tsx
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attemptsById, setAttemptsById] = useState<Record<string, AdminAttempt[]>>({});
  const [attemptsLoading, setAttemptsLoading] = useState<string | null>(null);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);
```

Add the handler, alongside `remove`:

```tsx
  const toggleAttempts = async (target: AdminUser) => {
    if (expandedId === target.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(target.id);
    setAttemptsError(null);
    if (attemptsById[target.id]) return;

    setAttemptsLoading(target.id);
    try {
      const { attempts } = await adminApi.getUserAttempts(target.id);
      setAttemptsById((prev) => ({ ...prev, [target.id]: attempts }));
    } catch (err) {
      setAttemptsError(err instanceof Error ? err.message : 'Failed to load attempts');
    } finally {
      setAttemptsLoading(null);
    }
  };
```

In the table body, add the toggle button to `.admin-actions` (before the role-toggle button) and a conditional expanded row, replacing the closing of the row's `</tr>`:

```tsx
                  <td className="admin-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void toggleAttempts(u)}
                      aria-label={expandedId === u.id ? 'Hide attempts' : 'View attempts'}
                      title={expandedId === u.id ? 'Hide attempts' : 'View attempts'}
                    >
                      <ChevronRightIcon
                        className={expandedId === u.id ? 'attempts-toggle-icon open' : 'attempts-toggle-icon'}
                      />
                    </button>
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
                </tr>
                {expandedId === u.id && (
                  <tr className="admin-attempts-row">
                    <td colSpan={6}>
                      {attemptsLoading === u.id ? (
                        <p>Loading attempts…</p>
                      ) : attemptsError ? (
                        <p role="alert" className="auth-error">
                          {attemptsError}
                        </p>
                      ) : (attemptsById[u.id]?.length ?? 0) === 0 ? (
                        <p>No attempts yet.</p>
                      ) : (
                        <AttemptsTable attempts={attemptsById[u.id]!.slice(0, 5)} />
                      )}
                    </td>
                  </tr>
                )}
```

The `.map` callback can only return one element per key, but now needs to return two sibling `<tr>` elements, so switch its wrapper from `<tr key={u.id}>...</tr>` to `<Fragment key={u.id}>...</Fragment>` wrapping both rows. Add `Fragment` to the React import at the top of the file:

```tsx
import { Fragment, useCallback, useEffect, useState } from 'react';
```

And change the body of the `.map` callback from:

```tsx
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id}>
                  {/* existing <td> cells ... */}
                </tr>
              );
            })}
```

to:

```tsx
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <Fragment key={u.id}>
                  <tr>
                    {/* existing <td> cells ... */}
                  </tr>
                  {expandedId === u.id && (
                    <tr className="admin-attempts-row">
                      {/* new expanded-row <td> from above */}
                    </tr>
                  )}
                </Fragment>
              );
            })}
```

(the `key={u.id}` moves from the `<tr>` to the `<Fragment>`; the inner `<tr>` no longer needs a key since it's not itself in a list).

Add to `frontend/src/App.css`, after `.icon-button-icon` (around line 575):

```css
.attempts-toggle-icon { transition: transform 0.15s ease; }
.attempts-toggle-icon.open { transform: rotate(90deg); }

.admin-attempts-row td { padding: 0.75rem 0.75rem 1rem; background: var(--accent-bg); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS (all existing tests + the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx frontend/src/App.css
git commit -m "feat(admin): expand a user row to show their quiz attempts"
```

---

### Task 4: Cap inline list at 5 and wire up "View all" modal

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Modify: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: `UserAttemptsModal` from Task 2 (`{ userLabel: string; attempts: AdminAttempt[]; onClose: () => void }`); the `attemptsById`/`expandedId` state from Task 3.
- Produces: finishes the feature — no further consumers.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/admin/AdminUsersPage.test.tsx`:

```tsx
  function manyAttempts(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      ...sampleAttempt,
      id: `a${i + 1}`,
      courseTitle: `Course ${i + 1}`,
    }));
  }

  test('caps the inline list at 5 and shows a "view all" button for more', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(6) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view all 6 attempts/i })).toBeInTheDocument();
  });

  test('does not show "view all" when there are 5 or fewer attempts', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(5) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));

    await screen.findByText('Course 1');
    expect(screen.queryByRole('button', { name: /view all/i })).not.toBeInTheDocument();
  });

  test('clicking "view all" opens a modal with the full attempt list, closable', async () => {
    getUserAttempts.mockResolvedValue({ attempts: manyAttempts(6) });
    render(<AdminUsersPage />);
    await screen.findByText('student@example.com');
    const studentRow = screen.getByText('student@example.com').closest('tr')!;

    fireEvent.click(within(studentRow).getByRole('button', { name: /view attempts/i }));
    fireEvent.click(await screen.findByRole('button', { name: /view all 6 attempts/i }));

    expect(await screen.findByText('Course 6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: FAIL — no "view all" button exists yet, so the first new test's `getByRole('button', { name: /view all 6 attempts/i })` throws.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/admin/AdminUsersPage.tsx`, add the import:

```tsx
import { UserAttemptsModal } from './UserAttemptsModal';
```

Add state alongside the Task 3 state:

```tsx
  const [modalUserId, setModalUserId] = useState<string | null>(null);
```

Replace the single-branch `AttemptsTable` render from Task 3 with a view-all-aware version:

```tsx
                      ) : (
                        <>
                          <AttemptsTable attempts={attemptsById[u.id]!.slice(0, 5)} />
                          {attemptsById[u.id]!.length > 5 && (
                            <button
                              type="button"
                              className="auth-submit-secondary"
                              onClick={() => setModalUserId(u.id)}
                            >
                              View all {attemptsById[u.id]!.length} attempts
                            </button>
                          )}
                        </>
                      )}
```

At the end of the component's returned JSX, after the closing `</table>`/`)` of the loading/table conditional and before the final `</div>`, add:

```tsx
      {modalUserId && (
        <UserAttemptsModal
          userLabel={users.find((u) => u.id === modalUserId)?.email ?? ''}
          attempts={attemptsById[modalUserId] ?? []}
          onClose={() => setModalUserId(null)}
        />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(admin): cap inline attempts at 5 with a view-all modal"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: all tests pass, including every test from Tasks 1-4 and the pre-existing `AdminUsersPage` tests.

- [ ] **Step 2: Type-check and lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run: `cd frontend && npm run dev` (with the backend running per the repo's normal dev setup), sign in as an admin, go to `/admin/users`, and:
- Expand a user with attempts → verify the mini table and correct Score/Status/Date formatting.
- Expand a user with 6+ attempts → verify "View all N attempts" appears, opens the modal, and the modal closes via the × button, an overlay click, and Escape.
- Expand a user with zero attempts → verify "No attempts yet."
- Collapse and re-expand a row → verify no extra network request in the Network tab.

- [ ] **Step 4: Commit (only if smoke testing revealed fixes)**

```bash
git add -A
git commit -m "fix(admin): address issues found in manual smoke test"
```

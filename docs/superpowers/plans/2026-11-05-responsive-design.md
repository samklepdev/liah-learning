# Responsive design for mobile and desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin tables, two-button action rows, and top navbar work well at phone widths, and confirm the rest of the app (which is already single-column) has no overflow issues at phone/tablet/desktop widths.

**Architecture:** Pure CSS plus a mechanical `data-label` attribute addition on table cells — no new components, no new state, no new business logic. One shared CSS rule (keyed off the existing `.admin-table` class) covers all four admin tables because they already share that class.

**Tech Stack:** React + TypeScript (Vite), plain CSS in `frontend/src/App.css` (no CSS framework), Vitest + React Testing Library for component tests, Chrome browser automation (`mcp__claude-in-chrome__*` tools) for visual/viewport verification.

## Global Constraints

- New breakpoint: `@media (max-width: 40rem)` (640px), added alongside the existing `@media (max-width: 48rem)` and `@media (max-width: 30rem)` blocks in `frontend/src/App.css`. Do not change the existing two breakpoints.
- `data-label` attribute values must exactly match the corresponding `<th>` text for that column (spec requirement — this is what the mobile card layout displays as the field label).
- The `.admin-actions` cell (icon buttons) gets no `data-label` and must not show a label in the card layout.
- No changes to component logic, props, or test mocks beyond what's needed to assert the new `data-label` attributes.
- Run `npm test` (vitest) from `frontend/` after every task; all existing tests must keep passing.

---

### Task 1: Label cells in `AttemptsTable`

**Files:**
- Modify: `frontend/src/pages/admin/AttemptsTable.tsx`
- Test: `frontend/src/pages/admin/AttemptsTable.test.tsx`

**Interfaces:**
- Consumes: nothing new — same `AttemptsTable({ attempts }: { attempts: AdminAttempt[] })` signature.
- Produces: each `<td>` in this table now carries `data-label` matching its column header (`Subject`, `Course`, `Score`, `Status`, `Date`). This is what Task 3's CSS keys off of. `AttemptsTable` is reused as-is inside `AdminUsersPage.tsx`'s expandable row and inside `UserAttemptsModal.tsx`, so no changes are needed in either of those two files.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/admin/AttemptsTable.test.tsx` (inside the existing `describe('AttemptsTable', ...)` block, alongside the other tests):

```tsx
test('labels each cell with its column name for the mobile card layout', () => {
  render(<AttemptsTable attempts={[completed]} />);
  const row = screen.getByText('CPR Basics').closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
    'Subject',
    'Course',
    'Score',
    'Status',
    'Date',
  ]);
});
```

This needs `within` imported from `@testing-library/react` — update the existing import line at the top of the file:

```tsx
import { render, screen, within } from '@testing-library/react';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/AttemptsTable.test.tsx`
Expected: FAIL — the new test's `expect(...).toEqual([...])` fails because every `data-label` attribute is currently `null`.

- [ ] **Step 3: Add the `data-label` attributes**

In `frontend/src/pages/admin/AttemptsTable.tsx`, change the `<tbody>` row to:

```tsx
<tbody>
  {attempts.map((attempt) => (
    <tr key={attempt.id}>
      <td data-label="Subject">{attempt.subjectSlug}</td>
      <td data-label="Course">{attempt.courseTitle}</td>
      <td data-label="Score">{formatScore(attempt)}</td>
      <td data-label="Status">{formatStatus(attempt)}</td>
      <td data-label="Date">{formatDate(attempt)}</td>
    </tr>
  ))}
</tbody>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/AttemptsTable.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AttemptsTable.tsx frontend/src/pages/admin/AttemptsTable.test.tsx
git commit -m "feat(frontend): label AttemptsTable cells for mobile card layout"
```

---

### Task 2: Label cells in `AdminUsersPage`'s three tables

**Files:**
- Modify: `frontend/src/pages/admin/AdminUsersPage.tsx`
- Test: `frontend/src/pages/admin/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: nothing new — same component, same `adminApi` mock shape already used in the test file.
- Produces: `data-label` attributes on every `<td>` in the main users table (`Email`, `First Name`, `Last Name`, `Role`, `Joined`; the `Actions` cell gets none), the import-preview table (`First Name`, `Last Name`, `Email`, `Role`), and the import-results "Created" table (`Email`, `First Name`, `Last Name`, `Role`, `Password`).

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the existing `describe('AdminUsersPage', ...)` block in `frontend/src/pages/admin/AdminUsersPage.test.tsx` (anywhere among the other tests — e.g. right after the `'lists every user with their role'` test):

```tsx
test('labels each cell in the main users table for the mobile card layout', async () => {
  render(<AdminUsersPage />);
  const row = (await screen.findByText('student@example.com')).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
    'Email',
    'First Name',
    'Last Name',
    'Role',
    'Joined',
    null,
  ]);
});

test('labels each cell in the import preview table for the mobile card layout', async () => {
  parseUserImport.mockResolvedValue({
    rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
    errors: [],
  });
  render(<AdminUsersPage />);
  await screen.findByText('admin@example.com');

  selectImportFile();
  fireEvent.click(screen.getByRole('button', { name: /parse/i }));

  const row = (await screen.findByText('jane@example.com')).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
    'First Name',
    'Last Name',
    'Email',
    'Role',
  ]);
});

test('labels each cell in the import results "Created" table for the mobile card layout', async () => {
  parseUserImport.mockResolvedValue({
    rows: [{ row: 2, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'user' }],
    errors: [],
  });
  confirmUserImport.mockResolvedValue({
    created: [
      { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', role: 'user', password: 'abc123' },
    ],
    skipped: [],
  });
  render(<AdminUsersPage />);
  await screen.findByText('admin@example.com');

  selectImportFile();
  fireEvent.click(screen.getByRole('button', { name: /parse/i }));
  await screen.findByRole('button', { name: /confirm import/i });
  fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));

  const row = (await screen.findByText('abc123')).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
    'Email',
    'First Name',
    'Last Name',
    'Role',
    'Password',
  ]);
});
```

`within` is already imported in this file's top import line (`import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';`), so no import change is needed here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: FAIL on the three new tests — every `data-label` attribute is currently `null`.

- [ ] **Step 3: Add the `data-label` attributes**

In `frontend/src/pages/admin/AdminUsersPage.tsx`, update the import-preview table's row (around line 210):

```tsx
<tr key={r.row}>
  <td data-label="First Name">{r.firstName ?? '—'}</td>
  <td data-label="Last Name">{r.lastName ?? '—'}</td>
  <td data-label="Email">{r.email}</td>
  <td data-label="Role">{r.role}</td>
</tr>
```

Update the import-results "Created" table's row (around line 270):

```tsx
<tr key={u.email}>
  <td data-label="Email">{u.email}</td>
  <td data-label="First Name">{u.firstName ?? '—'}</td>
  <td data-label="Last Name">{u.lastName ?? '—'}</td>
  <td data-label="Role">{u.role}</td>
  <td data-label="Password">{u.password}</td>
</tr>
```

Update the main users table's row (around line 341) — only the five data cells get a label; `admin-actions` stays as-is:

```tsx
<tr>
  <td data-label="Email">{u.email}</td>
  <td data-label="First Name">{u.firstName ?? '—'}</td>
  <td data-label="Last Name">{u.lastName ?? '—'}</td>
  <td data-label="Role">{u.role}</td>
  <td data-label="Joined">{new Date(u.createdAt).toLocaleDateString()}</td>
  <td className="admin-actions">
```

(Leave everything inside that `<td className="admin-actions">` — the three icon buttons — unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/AdminUsersPage.test.tsx`
Expected: PASS (all tests in the file, including the three new ones).

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — no regressions in any other file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/AdminUsersPage.tsx frontend/src/pages/admin/AdminUsersPage.test.tsx
git commit -m "feat(frontend): label AdminUsersPage table cells for mobile card layout"
```

---

### Task 3: Phone-width CSS — admin table cards, stacked actions, tighter topnav

**Files:**
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: the `data-label` attributes added in Tasks 1 and 2 (`attr(data-label)` in the new CSS reads them).
- Produces: a new `@media (max-width: 40rem)` block. Nothing downstream depends on new class names — this task only adds rules scoped to classes that already exist (`.admin-table`, `.admin-attempts-row`, `.profile-actions`, `.results-actions`, `.topnav`, `.topnav-brand`).

- [ ] **Step 1: Add the new breakpoint block**

Append this block to the end of `frontend/src/App.css` (after the existing `@media (max-width: 30rem)` block):

```css
/* ---- Phone-width layout (≤40rem) ---- */

@media (max-width: 40rem) {
  /* Admin tables become a card per row instead of scrolling sideways. */
  .admin-table thead {
    display: none;
  }

  .admin-table tr {
    display: block;
    margin-bottom: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .admin-table tbody tr:last-child {
    margin-bottom: 0;
  }

  .admin-table td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.3rem 0;
    border-bottom: none;
  }

  .admin-table td::before {
    content: attr(data-label);
    font-weight: 600;
    opacity: 0.7;
    flex: 0 0 auto;
  }

  /* The actions cell has no single label/value pair — render its icon
     buttons left-aligned instead of space-between, with no label. */
  .admin-table td.admin-actions {
    justify-content: flex-start;
  }

  .admin-table td.admin-actions::before {
    content: none;
  }

  /* The expandable attempts sub-row holds a nested table or paragraph, not
     a label/value pair — fall back to plain block layout. */
  .admin-attempts-row td {
    display: block;
  }

  /* Two-button rows get full-width stacked buttons instead of being
     squeezed side-by-side. */
  .profile-actions,
  .results-actions {
    flex-direction: column;
    align-items: stretch;
  }

  /* Tighten the navbar so brand + toggle + theme switch + account menu
     all fit without overlap down to 360px. */
  .topnav {
    gap: 0.5rem;
    padding: 0 0.6rem;
  }

  .topnav-brand {
    gap: 0.35rem;
  }
}
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — this is a CSS-only change, so no test behavior should change.

- [ ] **Step 3: Start the dev server**

Run (in the background, from `frontend/`): `npm run dev`
Expected: Vite prints a local URL, typically `http://localhost:5173`.

- [ ] **Step 4: Verify the admin tables render as cards at phone width**

Using the Chrome browser automation tools: open a tab to the dev server URL, sign in with your local dev admin account, and navigate to `/profile` → use the sidebar/nav to reach the Users admin page (or navigate directly to the admin users route shown in the sidebar once signed in as admin).

Resize the browser tab to 360×800 (`mcp__claude-in-chrome__resize_window`), then run this check with `mcp__claude-in-chrome__javascript_tool`:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

Expected: `false` (no horizontal overflow). Then visually confirm (via `read_page` or a screenshot) that the users table now renders as one bordered card per user, each showing `Email: …`, `First Name: …`, etc., with the action icon buttons at the bottom of the card.

Resize to 768×1024 and 1440×900 and re-run the same `scrollWidth > clientWidth` check at each width — expected `false` at both, and the table should render as a normal `<table>` (not cards) at both, since 768 and 1440 are both above the 640px breakpoint.

- [ ] **Step 5: Verify stacked action buttons**

Still at 360×800, navigate to `/profile` (while in edit mode, so both "Save profile" and "Cancel" are visible) and to a quiz results page (`/courses/:slug/results/:attemptId` for any completed attempt). Visually confirm both buttons in `.profile-actions` and both links in `.results-actions` are full-width and stacked vertically, not side-by-side.

- [ ] **Step 6: Verify the topnav doesn't clip at 360px**

Still at 360×800, on any authenticated page, visually confirm the brand mark + "LIAH Learning" text, the sidebar toggle, the theme toggle, and the account menu trigger are all visible and not overlapping. If they do overlap, reduce `.topnav` `gap` and `padding` further (and/or `.topnav-brand` `gap`) in the block from Step 1 until they fit, then re-run this check.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(frontend): phone-width layout for admin tables, action rows, and topnav"
```

---

### Task 4: Spot-check the remaining pages for overflow

**Files:**
- None expected. If Step 2 below finds a genuine overflow bug, modify: `frontend/src/App.css` (fix inline, following the pattern established in Task 3).

**Interfaces:**
- Consumes: the dev server already running from Task 3, Step 3 (restart it with `npm run dev` from `frontend/` if it's no longer running).
- Produces: nothing new — this task only verifies the spec's "out of scope / no changes expected" claim and closes out the feature.

- [ ] **Step 1: List the pages to check**

Auth/login page (`/login` or wherever signed-out users land), `/subjects` (course list), `/subjects/:subjectSlug` (subject courses), `/courses/:slug/quiz` (an in-progress quiz), `/courses/:slug/results/:attemptId` (results), `/progress`, and a not-found route (e.g. `/does-not-exist`).

- [ ] **Step 2: Check each page at 360×800, 768×1024, and 1440×900**

For each page in Step 1, at each of the three viewport sizes (`mcp__claude-in-chrome__resize_window`), navigate to it and run:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

via `mcp__claude-in-chrome__javascript_tool`. Expected: `false` at every page/width combination (21 checks total).

- [ ] **Step 3: Handle any failures**

If any check in Step 2 returns `true`, use `read_page` or a screenshot to identify which element is overflowing, then add a targeted CSS fix in `frontend/src/App.css` (inside the `@media (max-width: 40rem)` block from Task 3 if the overflow only happens at phone width, or unscoped if it happens at every width). Re-run that specific check to confirm it now returns `false`. Re-run `cd frontend && npm test` to confirm no regressions.

If all checks pass, no code changes are needed — this step is a no-op.

- [ ] **Step 4: Commit**

If Step 3 made any CSS changes:

```bash
git add frontend/src/App.css
git commit -m "fix(frontend): resolve mobile overflow found in responsive spot-check"
```

If Step 3 made no changes, there is nothing to commit — the feature is complete as of Task 3's commit.

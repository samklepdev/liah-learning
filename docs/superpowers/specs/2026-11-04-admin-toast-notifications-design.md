# Toast Notifications for Admin User Actions — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Give the admin visible feedback when deleting a user or confirming a bulk user import —
today both actions succeed silently (delete just removes the row; confirm shows a
results panel but nothing calls out that it worked).

## Scope

**In:** `react-hot-toast` added as a dependency; a single `<Toaster />` mounted once at
the app root so any future page can call `toast()`; two new success toasts on
`AdminUsersPage.tsx` — one after a successful delete, one after a successful import
confirm.

**Out:** error-path toasts (existing inline `role="alert"` text is untouched); a toast
for the promote/demote role action (not requested, stays silent-on-success as today);
replacing or redesigning the import results panel (the toast is a summary *in addition
to* that panel, not a replacement).

## Dependency

`react-hot-toast` added to `frontend/package.json`.

## Mounting

`frontend/src/main.tsx` renders `<Toaster />` once, as a sibling of `<App />` inside
`<AuthProvider>`:

```tsx
<AuthProvider>
  <App />
  <Toaster />
</AuthProvider>
```

This makes `toast()` callable from any component tree without further setup. This task
is the only caller today.

## Calls

In `frontend/src/pages/admin/AdminUsersPage.tsx`:

- **`remove`** (delete), on success (after `adminApi.deleteUser` resolves, before the
  local list splice): `toast.success('User deleted')`. The existing `catch` block's
  `setError(...)` and inline alert are unchanged.
- **`confirmImport`**, on success (after `adminApi.confirmUserImport` resolves): a
  one-line summary built from the response counts —
  - `created.length` only: `` `${created.length} users created` `` (singular "user"
    when exactly 1)
  - both `created.length` and `skipped.length` > 0: `` `${created.length} users
    created, ${skipped.length} skipped` ``
  The existing `catch` block's `setImportError(...)` and inline alert, and the detailed
  created/skipped results panel, are unchanged — the toast is a transient
  acknowledgement; the panel remains the durable record.

## Testing

- `AdminUsersPage.test.tsx`: the existing delete test gains an assertion that
  `toast.success` (mocked) was called with `'User deleted'`; the existing confirm test
  gains the same for the summary string. `react-hot-toast` is mocked at the module level
  (its real implementation renders into a portal that jsdom doesn't need to exercise
  here) — same pattern already used in this file for `adminApi`.

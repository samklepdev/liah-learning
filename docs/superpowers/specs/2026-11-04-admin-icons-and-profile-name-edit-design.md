# Icon Action Buttons + Self-Service Name Edit — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Two independent UI improvements:
1. Replace the text "Delete"/"Make admin"/"Make user" buttons on the admin users
   table with icon buttons.
2. Let a signed-in user edit their own first/last name from the Profile page — today
   `firstName`/`lastName` can only be set by an admin via the seed-import flow.

## Scope

**In:** two new icons (`TrashIcon`, `UserMinusIcon`); icon-only role-toggle/delete
buttons on `AdminUsersPage`; a `PATCH /api/auth/name` endpoint; a new "Edit name"
section on `ProfilePage`.

**Out:** admin editing another user's name from the admin table (still only possible
by deleting and re-seeding, or not at all — not requested); changing how the import
flow sets names; any icon changes outside the admin users table.

## Icons

Added to `frontend/src/shell/icons.tsx`, matching the file's existing inline-SVG
style (24px viewBox, `currentColor` stroke, no fill):

- `TrashIcon` — for delete.
- `UserMinusIcon` — for demoting an admin back to a user (a person outline with a
  small minus sign, visually distinct from `UserIcon`).

Promote-to-admin reuses the existing `UserIcon` (already in the file, used elsewhere
for the account menu).

## Admin table buttons

In `AdminUsersPage.tsx`, the role-toggle and delete buttons render only an icon:

```tsx
<button type="button" aria-label={u.role === 'admin' ? 'Make user' : 'Make admin'} title={...}>
  {u.role === 'admin' ? <UserMinusIcon className="icon-button-icon" /> : <UserIcon className="icon-button-icon" />}
</button>
<button type="button" aria-label="Delete" title="Delete">
  <TrashIcon className="icon-button-icon" />
</button>
```

`aria-label` carries the same text the buttons showed before, so existing tests that
query by accessible name (`getByRole('button', { name: /make admin/i })`, etc.) need
no changes — only the visible content changes, not the accessible name.

New CSS in `App.css`, modeled on the existing `.theme-toggle`/`.theme-icon` pattern
(bordered square button, hover/focus-visible states, ~1rem icon):

```css
.icon-button { ... }
.icon-button-icon { width: 1.05rem; height: 1.05rem; flex: 0 0 auto; }
```

## Self-service name edit

**Backend:**
- `user.model.ts`: `updateName(id: string, firstName: string | null, lastName: string | null): Promise<PublicUser | null>`.
- `auth.controller.ts`: new `updateName` handler. Body `{ firstName?: string, lastName?: string }`;
  each field is trimmed, and an empty string clears the field (stored as `null`) rather
  than being rejected — unlike the import flow's validation, this is an edit surface
  where un-setting a name back to blank is a legitimate action.
- `auth.routes.ts`: `authRouter.patch('/name', requireAuth, auth.updateName)`.

**Frontend:**
- `auth/api.ts`: `updateName: (firstName: string, lastName: string) => request<{ user: User }>('/auth/name', { method: 'PATCH', body: JSON.stringify({ firstName, lastName }) })`.
- `AuthState`/`AuthProvider`: add `updateUser: (user: User) => void`, so a successful
  name edit updates the cached user immediately (no `/auth/me` re-fetch or page reload
  needed) — the same way `login`/`register` already call `setUser` with the response.
- `ProfilePage.tsx`: a new "Edit name" section, above "Change password" — its own form,
  First Name/Last Name inputs pre-filled from the current user, its own Save button,
  no current-password confirmation (name is not security-sensitive, unlike the password
  change it sits next to).

## Testing

- `user.model.test.ts`: `updateName` sets/clears first and last name independently.
- `auth.controller.test.ts`: `PATCH /api/auth/name` requires a session; updates and
  returns the user; blank input clears a previously-set name.
- `ProfilePage.test.tsx`: the edit-name form submits and reflects the new name;
  `AdminUsersPage.test.tsx`'s existing promote/demote/delete tests continue to pass
  unmodified (same accessible names, different visible content).

# Remove self-service name editing (rework profile page)

## Problem

The profile page currently lets a logged-in user edit their own `firstName`/`lastName` via a combined name+password edit form (`PATCH /auth/name`). We want to remove this capability entirely — first/last name becomes permanently read-only after account creation, for everyone (including admins, who already have no edit-name capability today and are out of scope for this change). Password changes stay available.

## Scope

- Self-service name editing only: frontend profile page, its API client call, and the backend route/controller/model function that back it.
- Admin user-management screens are unaffected — they already display name read-only and have no edit-name feature; nothing to change there.
- No DB schema/migration change: `firstName`/`lastName` stay nullable (set once at creation via `createUser`, never written again).

## Design

### Frontend — `frontend/src/pages/ProfilePage.tsx`

Collapse the page to two independent pieces instead of one combined edit mode:

1. **Always-visible read-only details**: first name, last name, username, and role (admin only) — the existing `<dl className="profile-details">` block, but no longer gated behind an `isEditing` toggle. It's just always rendered.
2. **Password change**, toggled by a "Change password" button: current password / new password fields, same validation as today (both filled or both blank), same success/error handling, same `authApi.changePassword` call.

Remove: `firstName`/`lastName` state, `nameError` state, the combined `handleSave`/`Promise.allSettled` logic, the name `<input>` fields, and `startEditing`'s population of name fields. `updateUser` is no longer called from this page (nothing here changes `user` anymore).

### Frontend API — `frontend/src/auth/api.ts`

Delete `authApi.updateName`. Leave the `User` type's `firstName`/`lastName` fields as-is (still read for display).

### Backend

- `backend/src/routes/auth.routes.ts`: remove the `PATCH /name` route registration.
- `backend/src/controllers/auth.controller.ts`: remove `nameBody` schema and `updateNameHandler`.
- `backend/src/models/user.model.ts`: remove `updateName()`.

### Tests

- `frontend/src/pages/ProfilePage.test.tsx`: remove cases tied to name editing (prefill, save name, failed name update, clearing name). Keep/retain password-change cases, adjusted to the new standalone password form. Add a case confirming no name `<input>` ever renders.
- `backend/src/controllers/auth.controller.test.ts`: remove the `PATCH /api/v1/auth/name` test block (lines 112–201).
- `backend/src/models/user.model.test.ts`: remove the `updateName` test block (lines 91–117).

## Out of scope

- Any admin-facing ability to edit an existing user's name (doesn't exist today; not being added).
- Changing how `username` is derived or regenerated.
- DB schema changes to `firstName`/`lastName` nullability.

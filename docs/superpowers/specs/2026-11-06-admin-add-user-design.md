# Admin: manually add a single user

## Context

Admins can already bulk-create users via file import
(`admin-user-import.controller.ts`), which generates a username and a random
per-user password. This adds a one-off "add a single user" action for the
common case of onboarding one person, reusing the same creation path
(`createUser`, `findUserByName` dedup, username collision suffixing).

Alongside this, the password model changes: instead of a random per-user
password shown once, every newly created user (via single-add **and** bulk
import) gets the fixed initial password `liahwellness` and must change it on
first login. This is a deliberate trade simplicity for a touch of risk: a
shared initial password is a weaker secret than a random one, so it is paired
with a mandatory change-on-first-login gate to bound the exposure window to
"before the user first logs in."

## 1. Schema (`backend/src/models/schema.ts`)

- Add `mustChangePassword: boolean('must_change_password').notNull().default(false)` to `users`.
- No hand-written migration — goes through the existing `db:push` / `db:push:test` workflow (no committed `./drizzle` migration directory, per the username-login spec's precedent).

## 2. Fixed initial password

- New constant `INITIAL_PASSWORD = 'liahwellness'` in `user.model.ts`, since both creation paths (single-add, bulk-import) depend on it and already import from that module.
- `createUser` stays a thin insert — password policy (what hash, whether to force a change) is decided by each caller, not baked into the model. Its signature gains an explicit `mustChangePassword` parameter:

  ```ts
  createUser(firstName, lastName, passwordHash, role, mustChangePassword): Promise<PublicUser>
  ```

  Both admin creation paths hash `INITIAL_PASSWORD` and pass `mustChangePassword: true`. `register` (self-signup) hashes the user's chosen password and passes `mustChangePassword: false` — a user who sets their own password at registration has nothing to force-change.
- `PublicUser` / `publicColumns` gain `mustChangePassword`.
- `generatePassword()` in `admin-user-import.controller.ts` is deleted — no longer used.

## 3. Bulk import changes (`admin-user-import.controller.ts`)

- `confirmImport` hashes `INITIAL_PASSWORD` once per request (not per row — it's the same hash every time) and passes `mustChangePassword: true` to `createUser`.
- Response shape for `created` drops the `password` field (it's no longer per-user information — every row has the same password). `created: { username, firstName, lastName, role }[]`.
- `skipped` is unchanged.

## 4. Single-add endpoint (`admin-users.controller.ts`)

New handler `createUserHandler`:

```ts
const createUserBody = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  role: z.enum(['user', 'admin']),
});
```

- Validate body; `400` with `z.prettifyError` on failure (matching existing handlers' style).
- `findUserByName(firstName, lastName)` — if found, `400 { error: 'A user with this name already exists' }`.
- Hash `INITIAL_PASSWORD`, call `createUser(firstName, lastName, passwordHash, role, true)`.
- `201 { user }` — no password field in the response; the frontend already knows the fixed password and shows it in a toast, not an API-returned secret.

Route: `adminRouter.post('/users', adminUsers.createUserHandler)` in `admin.routes.ts`.

## 5. Forced password change on first login

- `auth.controller.ts`'s `changePassword` handler: after `updatePasswordHash`, also clear `mustChangePassword` to `false` for that user (single extra `db.update` or folded into the existing update — add a small `clearMustChangePassword` step in `user.model.ts`, or just include `mustChangePassword: false` in the same `set()` call `updatePasswordHash` already makes). No change to the handler's auth checks — it still requires `currentPassword` to verify, which for a freshly-created user is `liahwellness`.
- `me` and `login`/`register` responses already return the full `PublicUser`, so `user.mustChangePassword` reaches the frontend with no extra plumbing.

### Frontend gate (`router.tsx`)

New `RequireFreshPassword` wrapper, composed inside `RequireAuth` (so it only ever sees a signed-in user):

```tsx
function RequireFreshPassword({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.mustChangePassword) return <ForcedPasswordChangeForm />;
  return <>{children}</>;
}
```

Wraps the same route group `RequireAuth` currently wraps around `AppShell` (i.e. every signed-in route, admin routes included — an admin created by another admin still must change their password first).

`ForcedPasswordChangeForm` (new small component, `auth/ForcedPasswordChangeForm.tsx`):
- Explains once: "An admin created your account with a temporary password. Set your own password to continue."
- Reuses `authApi.changePassword(currentPassword, newPassword)` — same API call `ProfilePage` already uses, no new endpoint. `currentPassword` field is pre-labeled "Temporary password" rather than "Current password" for clarity, but it's the same input it already is.
- On success: `changePassword` resolved means the server has already cleared `mustChangePassword`, so the handler calls `updateUser({ ...user, mustChangePassword: false })` directly (no extra round-trip) so the gate re-evaluates and the app renders normally.
- No logout/cancel option — this screen is the only thing rendered until the password is changed.

### Types (`auth/api.ts`)

`User` gains `mustChangePassword: boolean`.

## 6. Admin UI: single-add form (`AdminUsersPage.tsx`)

New section above the existing "Seed users from a file" section (separate card, not merged into it — they're different actions):

```
## Add a user
[First name] [Last name] [Role: user/admin ▾]  [Add user]
```

- Local state: `firstName`, `lastName`, `role`, `addUserBusy`, `addUserError`.
- Submit calls new `adminApi.createUser(firstName, lastName, role)` → `POST /admin/users`.
- Success: `toast.success('User created. Initial password: liahwellness')`, clear the form, `load(pager.page)` to refresh the table (new user may land on another page, but refreshing page 1's data is consistent with how `confirmImport` already just calls `load(pager.page)` rather than jumping to the new row).
- Failure (duplicate name or validation): render inline under the form via the existing `auth-error` class, same pattern as `importError`. Keep the form's field values so the admin can correct and resubmit.

### `admin/api.ts`

```ts
createUser: (firstName: string, lastName: string, role: 'user' | 'admin') =>
  request<{ user: AdminUser }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ firstName, lastName, role }),
  }),
```

`ConfirmedUser` drops the `password` field (see §3).

## 7. Import results UI update (`AdminUsersPage.tsx`)

Since created users no longer carry a per-user password:
- Drop the "Password" column from the created-users table and from the CSV export (`username,firstName,lastName,role` header).
- Add a one-line note above the created-users table when `importResults.created.length > 0`: "Initial password for all created users: `liahwellness`".

## 8. Tests

- Backend: `admin-users.controller.test.ts` — new tests for `POST /admin/users` (success, duplicate-name rejection, validation errors, non-admin 403/404). `admin-user-import.controller.test.ts` — update fixtures/assertions to drop `password` from `created` and assert the shared hash instead. `auth.controller.test.ts` — `changePassword` clears `mustChangePassword`. `user.model.test.ts` — `createUser` persists `mustChangePassword`.
- Frontend: `AdminUsersPage.test.tsx` — add-user form success/duplicate-error paths; import-results table no longer shows a password column. New `router.test.tsx` (or extend existing) case: a user with `mustChangePassword: true` sees the forced-change form instead of any route, including `/admin/users`; submitting clears it and reveals the app.

## Out of scope

- Any password-strength/complexity rules beyond the existing `MIN_PASSWORD_LENGTH` on the new-password field — unchanged from today's `changePassword`.
- Rotating `liahwellness` itself or making it configurable — it's a hardcoded constant per this request.
- Retroactively flagging already-existing users (created before this change) as `mustChangePassword` — only new creations from this point forward are affected.

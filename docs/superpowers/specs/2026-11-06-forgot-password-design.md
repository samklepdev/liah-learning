# Forgot password: admin reset + request notification

## Context

There is no email field anywhere in the user model — login is by
system-generated `username` (see the username-login spec), so a classic
"email a reset link" flow is not possible without reopening that decision.
Admin-created and imported users already go through an equivalent flow:
they get the fixed `INITIAL_PASSWORD` and `mustChangePassword: true`, which
forces `ForcedPasswordChangeForm` on next login. This spec reuses that exact
mechanism for password recovery, and adds two things on top:

1. An admin-facing **reset password** action, usable on any user including
   other admins.
2. A **forgot password** link on the login page that lets a signed-out user
   flag their own account for a reset, without exposing who does or doesn't
   have an account.

A CLI break-glass script covers the case where there is no other admin
available to do the reset.

## 1. Schema (`backend/src/models/schema.ts`)

New table, `password_reset_requests`:

```ts
export const passwordResetRequests = pgTable('password_reset_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`userId` is `unique` so there is at most one pending request per user —
"collapse to one per user" is enforced by the schema, not by application
logic. No hand-written migration, per the existing `db:push` precedent.

## 2. Model (`backend/src/models/password-reset-request.model.ts`)

```ts
/** Upserts a pending request for this user — a repeat request just bumps
 *  requestedAt rather than creating a second row. */
export async function upsertPasswordResetRequest(userId: string): Promise<void>

/** All pending requests, joined to the user, newest first. */
export async function listPasswordResetRequests(): Promise<
  Array<{ userId: string; username: string; firstName: string | null; lastName: string | null; requestedAt: Date }>
>

/** No-op if there's no pending request for this user. */
export async function deletePasswordResetRequest(userId: string): Promise<void>
```

`upsertPasswordResetRequest` uses `onConflictDoUpdate({ target: ..., set: { requestedAt: sql\`now()\` } })`.

## 3. Public endpoint: submit a request

`auth.routes.ts`: `authRouter.post('/forgot-password', auth.forgotPassword)` —
no `requireAuth`, this is reached from the signed-out login page.

`auth.controller.ts`:

```ts
const forgotPasswordBody = z.object({ username: z.string().trim().min(1) });

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (parsed.success) {
    const user = await findUserByUsernameWithHash(parsed.data.username);
    if (user) await upsertPasswordResetRequest(user.id);
  }
  // Always 204, regardless of whether the username matched an active user —
  // same enumeration-avoidance principle as login's DUMMY_HASH compare.
  res.status(204).end();
}
```

Reuses `findUserByUsernameWithHash` purely for its existing
`isActive = true` filter (the hash itself is discarded) rather than adding a
new lookup function.

## 4. Admin endpoints (`admin.routes.ts`, under the existing `requireAuth, requireAdmin` mount)

```ts
adminRouter.get('/password-reset-requests', adminUsers.getPasswordResetRequests);
adminRouter.delete('/password-reset-requests/:userId', adminUsers.dismissPasswordResetRequest);
adminRouter.post('/users/:id/reset-password', adminUsers.resetUserPassword);
```

`admin-users.controller.ts`:

- `getPasswordResetRequests`: `res.json({ requests: await listPasswordResetRequests() })`.
- `dismissPasswordResetRequest`: `await deletePasswordResetRequest(param(req, 'userId')); res.status(204).end();`. No existence check needed — deleting a non-existent request is already a no-op.
- `resetUserPassword`:
  - `id === req.user!.id` → `400 { error: 'Use the change-password form to update your own password' }` (same self-action guard shape as `patchUserRole` / `deleteUser`).
  - Look up the target via `findUserById` (already imported); not found or `isActive === false` → `404 { error: 'User not found' }`.
  - Hash `INITIAL_PASSWORD`, `updatePasswordHash(id, hash)`, set `mustChangePassword: true` (new `setMustChangePassword(id, true)` in `user.model.ts`, mirroring the existing `clearMustChangePassword`), `deleteSessionsForUser(id)` (kills any live session immediately, same as self-service `changePassword`), `deletePasswordResetRequest(id)` (clears the queue entry as a side effect of resolving it).
  - `res.status(204).end()` — no password in the response; the admin already knows `INITIAL_PASSWORD`, same reasoning as the existing add-user/import flows.

This endpoint works on `role: 'admin'` targets too, with no special-casing —
that's how "another admin resets an admin" is satisfied without a second
mechanism.

## 5. Admin UI: new page (`frontend/src/pages/admin/PasswordRequestsPage.tsx`)

Route `/admin/password-reset-requests` in `router.tsx`, wrapped in
`RequireAdmin` like the other admin routes. Linked from `AccountMenu.tsx`
alongside Users / Courses / Recycle Bin.

Table: Username, First Name, Last Name, Requested At, Actions. Each row gets
two icon-button actions, matching `AdminUsersPage`'s existing style:

- **Reset password** — calls `adminApi.resetPassword(userId)`, then removes
  the row locally and toasts `'Password reset — user must set a new one at next login.'`.
- **Dismiss** — calls `adminApi.dismissPasswordRequest(userId)`, removes the
  row locally, toasts `'Request dismissed.'`.

Empty state: `"No pending password reset requests."` No pagination — this
list is expected to stay small; add it later if that assumption breaks.

### `admin/api.ts` additions

```ts
export type PasswordResetRequest = {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  requestedAt: string;
};

listPasswordRequests: () => request<{ requests: PasswordResetRequest[] }>('/admin/password-reset-requests'),
dismissPasswordRequest: (userId: string) =>
  request<void>(`/admin/password-reset-requests/${userId}`, { method: 'DELETE' }),
resetPassword: (userId: string) =>
  request<void>(`/admin/users/${userId}/reset-password`, { method: 'POST' }),
```

`resetPassword` is also wired into `AdminUsersPage.tsx`'s existing row
actions (a new icon button next to role-toggle/delete, disabled for
`isSelf`), since an admin should be able to reset a password proactively
without waiting for a request.

## 6. Login page UI (`frontend/src/auth/LoginForm.tsx`)

A third local mode alongside `'login' | 'register'`: `'forgot'`.

- Under the password field, login mode only: a text-button `"Forgot password?"` that sets mode to `'forgot'` (carrying over whatever is already typed in `username`).
- Forgot mode renders just the username input (same `aria-label="Username"` input, re-pointed at the shared `username` state) and a `"Notify admin"` submit button.
- On submit: `authApi.forgotPassword(username)`, then always render the same neutral message regardless of server response — `"If that username exists, an admin has been notified."` — never a success/failure branch that could leak whether the username exists.
- A `"Back to sign in"` link/button returns to `'login'` mode and clears the confirmation message.

### `auth/api.ts` addition

```ts
forgotPassword: (username: string) =>
  request<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username }) }),
```

## 7. Break-glass CLI script (`backend/src/scripts/reset-admin-password.ts`)

Modeled directly on `seed-admin.ts` — bypasses the API/auth entirely, for
the case where there is no other admin available to do the reset through
the UI:

```ts
export async function resetAdminPassword(username: string, password: string): Promise<void> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await updatePasswordHashByUsername(username, passwordHash); // new, username-keyed variant
  await setMustChangePasswordByUsername(username, true);
}
```

Reads `ADMIN_USERNAME` (required) and `ADMIN_PASSWORD` (optional, defaults
to `INITIAL_PASSWORD`) from env, same `main()` / `import.meta.url` guard
pattern as `seed-admin.ts`. Prints a confirmation and exits; errors if no
user with that username exists.

## 8. Tests

- Backend: `auth.controller.test.ts` — `POST /auth/forgot-password` always
  204s (known username, unknown username, soft-deleted username); known
  username creates/updates a `password_reset_requests` row; a second request
  for the same user updates `requestedAt` rather than inserting a second row.
  `admin-users.controller.test.ts` — `GET /admin/password-reset-requests`
  listing; `DELETE .../:userId` dismiss (including no-op on an absent
  request); `POST /admin/users/:id/reset-password` — success path clears
  `mustChangePassword`→true, kills sessions, clears the pending request;
  self-reset 400; inactive/missing-user 404; non-admin 404 (via the existing
  `requireAdmin` test pattern).
- Frontend: `LoginForm.test.tsx` — forgot-mode toggle, submit shows the
  neutral confirmation regardless of mocked response, back-to-sign-in reset.
  `PasswordRequestsPage.test.tsx` — list render, reset and dismiss both
  remove the row and toast. `AdminUsersPage.test.tsx` — new reset-password
  row action, disabled for self.

## Out of scope

- Rate limiting or CAPTCHA on `POST /auth/forgot-password` — small internal
  app, low abuse risk; revisit if it becomes a problem.
- Emailing or otherwise pushing a notification to admins when a request
  comes in — they have to check the Password Requests page.
- A badge/count on the `AccountMenu` link for pending requests — straightforward
  to add later, treated as polish rather than core scope here.
- Any password-strength change — reset reuses `INITIAL_PASSWORD`, same
  constant and same forced-change gate as account creation.

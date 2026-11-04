# User Profile & Change Password — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Give any signed-in user a profile page where they can see their account info and
change their password themselves, without an admin's help.

## Scope

**In:** a `/profile` page showing email + role (read-only), a change-password form
requiring the current password, server-side session revocation of every other
session on success.

**Out:** editing email or any other profile field, avatars/display names, "forgot
password" / email-based reset (no email delivery exists yet), 2FA.

## Data model

No schema change. `users.passwordHash` is already the only credential column; this
spec just adds a write path to it outside of registration.

## Backend

```
controllers/
  auth.controller.ts        + changePassword

routes/
  auth.routes.ts             + PATCH /auth/password (requireAuth)

models/
  user.model.ts              + findUserByIdWithHash, updatePasswordHash
  session.model.ts            (no change — deleteSessionsForUser already exists,
                               added for this exact purpose per its docstring)
```

### API

```
PATCH /api/auth/password   { currentPassword, newPassword } -> 204
```

Behaviour:
1. `requireAuth` resolves `req.user` as today.
2. Validate body with zod — `newPassword` reuses the existing `credentials.password`
   rule (min 8, max 256); `currentPassword` just needs to be a non-empty string.
3. Load the full row via `findUserByIdWithHash(req.user.id)` and `argon2.verify` the
   supplied `currentPassword`. Mismatch -> `401 { error: 'Current password is incorrect' }`.
4. On match: hash `newPassword` with argon2id, `updatePasswordHash`, then
   `deleteSessionsForUser(req.user.id)` followed by `startSession` (the same helper
   `login`/`register` use) so the **current** request gets a fresh cookie — every
   other device/session is signed out, this one stays signed in transparently.
5. Respond `204`.

No timing-equalizer dummy hash is needed here (unlike login) — the attacker-facing
risk login's `DUMMY_HASH` defends against (enumerating valid emails) doesn't apply
to an endpoint that's already behind `requireAuth` and keyed to the caller's own id.

## Frontend

```
auth/api.ts                 + authApi.changePassword(currentPassword, newPassword)
                               -> PATCH /auth/password

pages/
  ProfilePage.tsx            email + role (read-only), change-password form reusing
                             the auth-* classes from LoginForm.tsx (same field/error/
                             submit styling, same MIN_PASSWORD_LENGTH hint)

router.tsx                  + /profile, nested under the existing RequireAuth +
                             AppShell wrapper (no RequireAdmin — every signed-in
                             user gets this)

shell/AccountMenu.tsx        + "Profile" link, above "Sign out", before the
                             admin-only divider. Replaces the "a profile page
                             later" comment.
```

On a successful password change the form shows a success message and clears both
password fields; it does not log the user out, matching the backend's "stay signed
in on this device" behaviour.

## Error handling

| Case | Behaviour |
|---|---|
| Wrong current password | `401 { error: 'Current password is incorrect' }`; form shows the message, fields stay editable |
| New password fails the length rule | `400` with zod's prettified message (mirrors register) |
| Request without a session | `401` via existing `requireAuth` (unreachable through the UI since the route requires auth) |
| Success | `204`; other sessions for this user are gone, this session continues on a new token |

## Testing

- Backend `auth.controller.test.ts`: wrong current password rejected, too-short new
  password rejected, happy path updates the hash, old session token stops working
  after a successful change while the new cookie still works
- `user.model.test.ts`: `findUserByIdWithHash` returns the hash, `updatePasswordHash`
  persists and is reflected in a subsequent `findUserByIdWithHash`
- Frontend: `ProfilePage` test mirroring `LoginForm`'s style — wrong-password error,
  success message + field clearing, busy state during submit
- `AccountMenu` test: Profile link present and routes to `/profile` for both roles

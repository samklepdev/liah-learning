# Username login (replacing email)

## Context

The app currently identifies and authenticates users by email. This change
removes email from the user model entirely and replaces it with a
system-generated `username`, derived from first/last name. Login switches
from email+password to username+password.

This is a dev-only change — no production user data exists, so the database
can be reset/reseeded rather than migrated in place.

## 1. Schema (`backend/src/models/schema.ts`)

- Drop the `email` column (and its unique constraint). Delete the
  `normalizeEmail()` helper it referenced in a comment — it becomes dead code.
- Add `username: text('username').notNull().unique()`.
- `firstName` / `lastName` remain nullable columns (the profile edit form can
  still blank them later). Every *creation* path, however, requires both to
  be present, since the username is derived from them once, at creation time.
- No hand-written migration: the repo has no committed `./drizzle` migration
  directory, so this goes through the existing `db:push` / `db:push:test`
  dev workflow.

## 2. Username generation (`backend/src/lib/username.ts`)

`buildBaseUsername(firstName, lastName): string`
- Lowercase, strip to alphanumeric-only: `firstName[0] + lastName`.
  e.g. "John O'Brien" → `jobrien`.
- Fallback: if the stripped base is empty (punctuation-only names), use
  `"user"` as the base.

Uniqueness is resolved at insert time, not by pre-checking:
- Try inserting with the base username.
- On conflict (`onConflictDoNothing({ target: users.username })` returns no
  row), retry with `base + 2`, `base + 3`, ... up to 1000 attempts, then
  throw.
- This mirrors the existing email-conflict-retry pattern and is race-safe
  since callers await each attempt sequentially.

This insert-with-retry logic lives in `user.model.ts` and is shared by all
three creation paths: self-registration, admin import, and `seed-admin.ts`.

## 3. Backend auth & model changes

- **`user.model.ts`**: `PublicUser` swaps `email` → `username`.
  `createUser(firstName, lastName, passwordHash, role?)` requires firstName
  and lastName (no longer optional), generates the username internally, and
  no longer returns `null` for "already registered" — that failure mode no
  longer exists; only the generated username differs on a name collision.
  `findUserByEmailWithHash` → `findUserByUsernameWithHash`. New
  `findUserByName(firstName, lastName)` for the import dedup check (see
  §4).
- **`auth.controller.ts`**:
  - `register`: body becomes `{ firstName, lastName, password }` (zod:
    both names required, trimmed, min length 1). Calls `createUser`, starts
    a session, returns the user (including generated `username`). The 409
    "already registered" path is removed.
  - `login`: body becomes `{ username, password }`. Looks up via
    `findUserByUsernameWithHash`. Same timing-safe dummy-hash behavior as
    today.
  - `changePassword` / `me` / `updateName`: unchanged logic, carry
    `username` through instead of `email`.
- **`session.model.ts`**: selects `username` instead of `email` in the
  joined public-user shape.
- **`routes/index.ts`**: welcome message uses `req.user!.username`.
- **`admin-user.model.ts`**: `publicColumns` swaps `email` → `username`.

## 4. Admin bulk import

**`user-import-parser.ts`**
- Drop the `email` column entirely. `firstName` and `lastName` become
  required (currently optional) — a row fails validation if either is
  blank. Column-missing error messages change accordingly (e.g. "File is
  missing a 'First Name' column"). `ParsedUserRow` drops `email`.

**`admin-user-import.controller.ts`**
- For each row, check for an existing user with an exact,
  case-insensitive firstName+lastName match (`findUserByName`). If found,
  skip creating it and report under `skipped` (reason: "already
  registered") — same response shape as today, just keyed on name instead
  of email. This preserves the old email-dedup behavior (re-importing the
  same file won't silently create `jsmith2`, `jsmith3`, ...).
- Otherwise: generate username + random password as today, create the
  user, report it under `created` with `username` instead of `email`.

## 5. Seed script (`seed-admin.ts`)

- Env vars become `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` (replacing
  `ADMIN_EMAIL`). `ADMIN_PASSWORD` stays, now defaulting to
  `'liahwellness'` if unset.
- Drop the upsert-by-identifier behavior — it stops being safe once the
  identifier is auto-generated (re-running with the same name would
  otherwise either silently promote an unrelated existing `jsmith` to
  admin, or create `jsmith2`). The script becomes insert-only through the
  same `createUser` retry path, and prints the resulting username so the
  operator knows what to log in with.

## 6. Frontend

- **`auth/api.ts` / `auth/context.ts` / `auth/AuthProvider.tsx`**:
  `User.email` → `User.username`; `login(username, password)`;
  `register(firstName, lastName, password)`.
- **`auth/LoginForm.tsx`**: login mode gets a single "Username" text input
  (`autoComplete="username"`) instead of email. Register mode gets two
  inputs — First name, Last name — instead of one email input (password
  field unchanged). Registration auto-starts a session on success, so the
  user lands in the app already signed in and sees their generated
  username in the account menu — no separate "here's your username"
  screen is needed.
- **Display spots** (`AppShell.tsx`, `AccountMenu.tsx`, `ProfilePage.tsx`):
  `user.email` → `user.username`.
- **`AdminUsersPage.tsx`**: table columns, CSV export header/rows
  (`email,firstName,...` → `username,firstName,...`), and React keys
  (`key={u.email}` → `key={u.username}`) switch from email to username.
  Import preview table drops the Email column.
- **`admin/api.ts`**: type fields `email` → `username` in created-user /
  imported-row / skipped-user shapes.

## 7. Tests

All tests currently asserting on `email` are updated in place to use
`username` / `firstName` / `lastName` fixtures instead of email strings:

- Backend: `auth.controller.test.ts`, `admin-user.model.test.ts`,
  `user-import-parser.test.ts`, `admin-user-import.controller.test.ts`,
  `auth.middleware.test.ts`.
- Frontend: `logout-navigation.test.tsx`, `router.test.tsx`,
  `router.admin-guard.test.tsx`, `admin/api.test.ts`,
  `AccountMenu.test.tsx`, `AppShell.test.tsx`, `ProfilePage.test.tsx`,
  `AdminUsersPage.test.tsx`.
- Test helper `registerTestUser(baseUrl, email)` in
  `backend/src/test/helpers/server.ts` becomes
  `registerTestUser(baseUrl, firstName, lastName)`.

## Out of scope

- Migrating existing production user data (none exists; dev-only reset is
  acceptable).
- Changing the admin-import random password generation (`generatePassword`)
  — that stays as-is; only the identifier changes.

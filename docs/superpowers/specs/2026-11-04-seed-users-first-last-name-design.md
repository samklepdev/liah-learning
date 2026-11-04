# Split Seeded-User `name` into `firstName`/`lastName` — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Replace the single `name` field added by the seed-users-import feature (still unmerged
on `feat/seed-users-import`) with separate `firstName`/`lastName` fields, before that
branch merges. Amends
[2026-11-04-seed-users-import-design.md](2026-11-04-seed-users-import-design.md) — read
that spec first; this document only covers the delta.

## Scope

**In:** replacing `name` with `firstName`/`lastName` everywhere it currently appears in
the unmerged seed-users feature (schema, parser, controller, frontend types, admin UI).

**Out:** self-registration or the profile page — neither has a name field today, and
this change doesn't add one there. First/last name stays specific to admin-seeded users.

## Data model

```ts
firstName: text('first_name'), // nullable
lastName: text('last_name'),   // nullable
```

Replaces the single `name: text('name')` column. Both fields are independently
optional, same looseness as the field they replace — an admin can supply just one,
both, or neither.

## File formats

- **xlsx/csv** — header gains two columns, `First Name` and `Last Name`, matching the
  existing case-insensitive, any-order convention used for `Email`/`Role`.
- **PDF/`.txt`** — still headerless and positional; each line becomes
  `First Name, Last Name, Email, Role`.

## Propagation

Every place `name`/`PublicUser.name` currently flows gets `firstName`/`lastName`
instead:

```
backend/src/models/schema.ts              users table columns
backend/src/models/user.model.ts          PublicUser, publicColumns, createUser(...)
backend/src/models/admin-user.model.ts    publicColumns
backend/src/models/session.model.ts       findUserBySessionId's select
backend/src/lib/user-import-parser.ts     ParsedUserRow, header detection, both
                                           parse branches (parseSpreadsheet, parsePdfLines)
backend/src/controllers/
  admin-user-import.controller.ts         confirmBody schema, created[] response shape
frontend/src/auth/api.ts                  User type
frontend/src/admin/api.ts                 ImportedUserRow, ConfirmedUser types
frontend/src/pages/admin/
  AdminUsersPage.tsx                      users table, preview table, results table,
                                           CSV export header
```

`createUser`'s signature changes from `(email, passwordHash, name?, role?)` to
`(email, passwordHash, firstName?, lastName?, role?)`.

## Testing

Existing tests across all the files above that reference `name` get updated to
`firstName`/`lastName` in place — same coverage, same scenarios (optional field,
defaults to `null`, header case-insensitivity, row validation), just two fields
instead of one. No new scenarios beyond what the original spec already covered.

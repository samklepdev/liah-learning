# Seed Users via Admin Upload (xlsx/csv/PDF) — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Let an admin bulk-create user accounts by uploading a file (xlsx, csv, or PDF) instead
of registering each one by hand or via the `seed:admin` CLI script.

## Scope

**In:** upload xlsx/csv/PDF containing name/email/role rows, preview-then-confirm
import (matching the existing quiz-content import flow), auto-generated passwords shown
once after confirm, duplicate-email rows reported as skipped.

**Out:** emailing invites or reset links, forcing a password change on first login,
editing/removing users via the same flow (the existing role/delete actions on
`AdminUsersPage` already cover that), re-importing to update existing users.

## Data model

One column added to the existing `users` table:

```ts
name: text('name'), // nullable; only seeded users have one today
```

No other schema change. Self-registered users keep `name = null`.

## File formats

All three formats produce the same row shape: `{ name?, email, role? }`.

- **xlsx/csv** — parsed with SheetJS (`xlsx` package, new dependency; it reads both
  formats through the same API). First row is a header (`Name`, `Email`, `Role`,
  case-insensitive); columns may appear in any order.
- **PDF** — text extracted via the existing `pdftotext -layout` pathway (same as
  `admin-import.controller.ts`), then parsed one row per line,
  comma-separated: `Name, Email, Role`. No header row for PDF — every line is a record.

Per-row validation (same for all three formats, run during `/parse`):
- `email` required, must be a valid email
- `role` optional, defaults to `user`; if present must be `user` or `admin`
- `name` optional

Invalid rows are collected as row-level errors (`{ row: number, message: string }`) and
shown in the preview — they don't block the valid rows in the same file.

## Backend

```
lib/
  user-import-parser.ts     parseUserRows(buffer, filename) -> { rows, errors }
                              dispatches by extension to a SheetJS reader or
                              pdftotext + line-split reader, then runs shared
                              per-row validation

controllers/
  admin-user-import.controller.ts
    parseImport    multer upload (field "file", 5MB limit) -> user-import-parser
                   -> { rows, errors }, nothing written yet
    confirmImport  body = { rows } round-tripped from /parse -> for each row:
                     existing email -> push to `skipped` (no mutation)
                     else -> generate random password (node:crypto), argon2 hash,
                             insert with name/role -> push to `created` with the
                             plaintext password
                   -> { created: [{ email, name, role, password }],
                        skipped: [{ email, reason }] }

routes/
  admin.routes.ts            + adminRouter.use('/users/import', adminUserImportRouter)

models/
  user.model.ts               createUser gains an optional name param
```

### API

```
POST /api/admin/users/import/parse     multipart file -> { rows, errors }
POST /api/admin/users/import/confirm   { rows } -> { created, skipped }
```

Stateless parse step, same reasoning as the quiz importer: the parsed rows round-trip
through the browser between `/parse` and `/confirm` instead of being staged
server-side, so there's no temp file or expiry to manage.

Generated passwords are returned once, in the `/confirm` response, and never stored or
logged in plaintext — only their argon2 hash is persisted. If the admin navigates away
before copying them, the accounts still exist but the passwords are unrecoverable (the
admin would use the existing role/delete actions plus a fresh invite, or the user would
need a password reset path — out of scope here since none exists yet for self-serve
reset).

## Frontend

```
admin/api.ts                 + parseUserImport(file), confirmUserImport(rows)

pages/admin/
  AdminUsersPage.tsx          + an upload section above the user table: file input ->
                               "Parse" -> preview table (rows + row errors) -> "Confirm
                               import" -> results panel (created rows with
                               copyable/exportable passwords, skipped rows with reason)
                               -> reloads the user list
```

No new route — this lives on the existing `/admin/users` page since it's a variation
on user management, not a separate content type like the quiz importer.

## Error handling

| Case | Behaviour |
|---|---|
| Unsupported file extension | `/parse` returns `{ errors: [...] }`, no rows |
| Row missing/invalid email | Row-level error in the preview; other valid rows in the file still import |
| Row role not `user`/`admin` | Row-level error in the preview |
| Email already registered | Not an error — reported in `/confirm`'s `skipped` list with reason `"already registered"` |
| Empty file / zero valid rows | `/parse` returns `{ rows: [], errors: [...] }`; Confirm button disabled on the frontend when there are no valid rows |
| pdftotext extraction failure | Same 422 handling as the existing PDF import path |

## Testing

- `user-import-parser.ts` unit tests: xlsx happy path, csv happy path, PDF line
  parsing, header-order independence for xlsx/csv, row-level validation errors,
  case-insensitive role/header matching
- `admin-user-import.controller.ts` integration tests: `/parse` surfaces row errors
  without writing to the DB; `/confirm` creates new users with hashed passwords,
  skips existing emails without mutating them, returns plaintext passwords only in
  the response body
- Frontend: upload section renders preview and results panels, Confirm disabled with
  zero valid rows, user list reloads after a successful import

# Admin Section — Design

**Date:** 2026-11-04
**Status:** Approved

## Goal

Give an admin user management of accounts and a way to import quiz content without the
CLI. This is the first of several admin slices — content editing and a full
cross-user grade dashboard are separate future specs.

## Scope

**In:** user list, promote/demote role, delete user, view a single user's attempt
history, PDF upload with a preview-then-confirm import flow.

**Out:** editing existing quiz/course content, a full grade/attempt dashboard across
all users, timed quizzes, instructor accounts, self-serve admin bootstrap.

## Data model

One column added to the existing `users` table:

```ts
role: text('role').notNull().default('user'), // 'user' | 'admin'
```

No new table — a user is either role, no multi-role or permission matrix. The first
admin is granted by hand (direct DB update or a one-off script); every admin after that
is created via the promote action this spec adds.

## Backend

```
middleware/
  auth.middleware.ts        + requireAdmin (runs after requireAuth; checks req.user.role)

routes/
  admin.routes.ts           mounted at /api/admin, requireAuth + requireAdmin on all of it

controllers/
  admin-users.controller.ts
  admin-import.controller.ts

models/
  user.model.ts             + listUsers, setUserRole, deleteUser
```

### API

```
GET    /api/admin/users                 list (id, email, role, createdAt)
PATCH  /api/admin/users/:id/role         { role: 'user' | 'admin' }
DELETE /api/admin/users/:id             cascades to sessions/attempts via existing FKs
GET    /api/admin/users/:id/attempts    this user's attempt history (course, score, dates)

POST   /api/admin/import/parse          multipart PDF -> pdftotext + existing
                                         quiz-parser.ts -> { summary } or { errors },
                                         nothing written yet
POST   /api/admin/import/confirm        body = the parsed JSON from /parse -> existing
                                         seed-quizzes logic (upsert by slug) -> row counts
```

The parse step is stateless on the server: the parsed JSON round-trips through the
browser between `/parse` and `/confirm` instead of being staged server-side, so there's
no temp file or expiry to manage. Both endpoints reuse `quiz-parser.ts` and the seed
logic unchanged — only the entry point moves from CLI args to an HTTP body.

A safety rail: an admin cannot demote or delete their own account, so the system can
never end up with zero admins.

## Frontend

```
pages/admin/
  AdminUsersPage.tsx    table: email, role, created, [promote/demote] [delete],
                         link to attempt history
  AdminImportPage.tsx   file input -> parse preview (counts or errors) -> Confirm/Cancel

router.tsx              /admin/users, /admin/import nested under the existing
                         RequireAuth + AppShell wrapper, plus a RequireAdmin guard that
                         renders the 404 page (not a 403) for non-admins — consistent
                         with the existing "don't confirm it exists" pattern used for
                         other users' attempt ids

shell/SidebarNav.tsx    + "Admin" section, rendered only when user.role === 'admin'
```

## Error handling

| Case | Behaviour |
|---|---|
| Non-admin hits `/admin/*` or `/api/admin/*` | 404 page / 404 JSON, not 403 |
| Admin tries to demote/delete their own account | 400; button disabled client-side too |
| Parser assertion fails on upload | `/parse` returns `{ errors: [...] }`, not a 500; no Confirm button shown |
| Re-uploading a subject already seeded | `/confirm` upserts by slug — same idempotency as the CLI seed |
| Delete user with attempts | Cascades per existing `onDelete: 'cascade'` FKs |

## Testing

- `requireAdmin` unit test: 401 when signed out, 404 when signed in as non-admin, pass-through for an admin
- Admin user-model tests: list, role change, delete cascades, self-protection against demote/delete
- Parse/confirm integration test reusing existing parser fixtures: `/parse` surfaces errors instead of throwing; `/confirm` is idempotent on re-seed
- Frontend: AdminUsersPage and AdminImportPage render/interaction tests; SidebarNav shows/hides Admin by role; router 404s non-admins hitting `/admin/*`

# Soft delete for users & courses + admin recycle bin

## Problem

Admins can only hard-delete a user today (`DELETE /admin/users/:id`), and there is no way at all to remove a course — courses only come into existence via the quiz-pack import. We want `isActive` on both `users` and `courses`, a soft-delete flow instead of permanent removal, and an admin "Recycle Bin" page to restore anything soft-deleted. Every existing fetch of users/courses must only return active rows; soft-deleted users must also be unable to log in or keep an existing session.

## Scope

- `users` and `courses` tables gain `isActive boolean not null default true` and `deletedAt timestamp with time zone` (nullable), set together.
- Existing hard `DELETE /admin/users/:id` becomes a soft delete. No hard/permanent-delete action is introduced anywhere in this change.
- A new admin Courses page (none exists today) so there's a place to soft-delete a course from.
- A new admin Recycle Bin page with two tabs — Deleted Users, Deleted Courses — each with a Restore action.
- `subjects` table is unaffected — not in scope.
- Historical views are unaffected: a soft-deleted course still appears in a learner's own `My Progress` / past-attempt history. Only the active catalog (subject → course listing used to browse/start a course) filters on `isActive`.
- Soft-deleting a user kills their sessions immediately (`deleteSessionsForUser`); a soft-deleted user also can't log in.
- The existing self-delete guard (an admin can't delete their own account) is unchanged.

## Data model — `backend/src/models/schema.ts`

Add to both `users` and `courses`:

```ts
isActive: boolean('is_active').notNull().default(true),
deletedAt: timestamp('deleted_at', { withTimezone: true }),
```

Soft delete sets `{ isActive: false, deletedAt: new Date() }`; restore sets `{ isActive: true, deletedAt: null }`. Generate a Drizzle migration for both columns on both tables.

## Backend

### `backend/src/models/user.model.ts`

- `findUserByUsernameWithHash`: add `isActive = true` to the `where` — a soft-deleted user's credentials no longer authenticate.

### `backend/src/models/session.model.ts`

- `findUserBySessionId`: add `isActive = true` to the join condition — a soft-deleted user's existing cookie stops resolving to a session even before it expires.

### `backend/src/models/admin-user.model.ts`

- `publicColumns`: add `isActive`, `deletedAt`.
- `listUsers` / `countUsers`: filter `isActive = true`.
- `deleteUserById` → soft delete: set `isActive: false, deletedAt: now`, then call `deleteSessionsForUser(id)`. Keep returning whether a row was affected (guard against double-delete: only update rows where `isActive = true`).
- New `listDeletedUsers(page)` / `countDeletedUsers()`: same shape as `listUsers`/`countUsers` but filter `isActive = false`, ordered by `deletedAt` desc.
- New `restoreUserById(id)`: set `isActive: true, deletedAt: null` where `isActive = false`; return the restored row or null.

### `backend/src/controllers/admin-users.controller.ts`

- `deleteUser`: no change needed beyond the model now soft-deleting; self-delete guard stays as-is.
- New `getDeletedUsers` (paginated, same `parsePage`/`PAGE_SIZE` pattern as `getUsers`) and `restoreUserHandler` (404 if not found/not deleted).

### `backend/src/routes/admin.routes.ts`

- Add `GET /users/deleted` → `getDeletedUsers`.
- Add `POST /users/:id/restore` → `restoreUserHandler`.

### New `backend/src/models/admin-course.model.ts`

Mirrors `admin-user.model.ts` for courses:

- `listCourses()`: active courses joined to their subject (title/slug) for display, ordered by subject title then course position.
- `deleteCourseById(id)`: soft delete (`isActive: false, deletedAt: now`), only where currently active.
- `listDeletedCourses()`: inactive courses + subject info, ordered by `deletedAt` desc.
- `restoreCourseById(id)`: set `isActive: true, deletedAt: null` where currently inactive.

No pagination for courses — course counts are small (import-seeded, tens not thousands) and the existing admin tables that paginate (users) are the ones expected to grow large.

### New `backend/src/controllers/admin-courses.controller.ts`

`getCourses`, `deleteCourse`, `getDeletedCourses`, `restoreCourseHandler` — same shape as the user-admin controller handlers.

### `backend/src/routes/admin.routes.ts` (continued)

```
adminRouter.get('/courses', adminCourses.getCourses);
adminRouter.delete('/courses/:id', adminCourses.deleteCourse);
adminRouter.get('/courses/deleted', adminCourses.getDeletedCourses);
adminRouter.post('/courses/:id/restore', adminCourses.restoreCourseHandler);
```

### `backend/src/models/catalog.model.ts`

- `listSubjects`: join only `isActive = true` courses when computing `courseCount` (a subject whose only courses are all deleted should show `courseCount: 0`, not count deleted ones).
- `listCoursesBySubject`: add `isActive = true` to the courses `where`.
- `findMyProgress` (in `attempt.model.ts`, used by `/progress`) is untouched — deliberately not filtered, per scope above.

## Frontend

### `frontend/src/admin/api.ts`

Add `AdminCourse` type (`id, slug, title, position, passScore, questionCount, subjectTitle, subjectSlug, isActive, deletedAt`) and functions: `listCourses`, `deleteCourse`, `listDeletedCourses`, `restoreCourse`, `listDeletedUsers`, `restoreUser`. Extend `AdminUser` type with `isActive`/`deletedAt` (unused for display today but returned by the API).

### New `frontend/src/pages/admin/AdminCoursesPage.tsx`

Table grouped/sorted by subject, columns: Subject, Course, Position, Pass score, Questions, Actions (Delete — trash icon, same `icon-button`/`TrashIcon` pattern as `AdminUsersPage`). No add/edit here — courses are still only created via import; this page only supports removing one.

### New `frontend/src/pages/admin/RecycleBinPage.tsx`

Tab switcher ("Deleted Users" / "Deleted Courses"), each tab a table (reusing `Pager`/`usePager` for the users tab since that list is paginated server-side; courses tab renders its full list, unpaginated) with a Restore icon button per row. Restoring removes the row from the current tab's list (optimistic, same pattern as `remove` in `AdminUsersPage`) and shows a success toast.

### `frontend/src/shell/AccountMenu.tsx`

Add two links after the existing admin links, same pattern:

```tsx
<NavLink to="/admin/courses" className="account-menu-item" onClick={() => setOpen(false)}>
  <CogIcon className="nav-icon" />
  Admin · Courses
</NavLink>
<NavLink to="/admin/recycle-bin" className="account-menu-item" onClick={() => setOpen(false)}>
  <CogIcon className="nav-icon" />
  Admin · Recycle Bin
</NavLink>
```

### `frontend/src/router.tsx`

Add `/admin/courses` and `/admin/recycle-bin` routes, gated the same way as `/admin/users` and `/admin/import` (the existing `RequireAdmin`-style wrapper that 404s for non-admins).

## Testing

- Backend model/controller tests (mirroring existing `*.test.ts` files):
  - Soft-deleting a user: row still exists with `isActive: false`; excluded from `listUsers`/login/session lookup; sessions are gone.
  - Restoring a user: reappears in `listUsers`, can log in again.
  - Soft-deleting a course: excluded from `GET /courses` catalog listing; still present in `/progress` for a user with a prior attempt on it.
  - Restoring a course: reappears in the catalog at its original position.
  - Self-delete guard still rejects deleting your own account.
  - Double-delete / restore-when-not-deleted return 404, not a silent no-op 204.
- Frontend component tests for `AdminCoursesPage` and `RecycleBinPage` following the existing `AdminUsersPage.test.tsx` conventions (render, delete/restore interaction, error state).

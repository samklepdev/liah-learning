# Admin: view a user's grades/attempts

## Problem

Admins can manage users (role, delete, import) on the Users page, but have no way
to see a given user's quiz grades or attempt history. The backend and frontend
API client already support this (see Existing support below); only the UI is
missing.

## Existing support (no changes needed)

- `backend/src/models/admin-attempt.model.ts` — `listAttemptsForUser(userId)`
  returns attempts joined with course/subject, newest first.
- `backend/src/controllers/admin-users.controller.ts` — `getUserAttempts`
  handler.
- `backend/src/routes/admin.routes.ts` — `GET /admin/users/:id/attempts`.
- `frontend/src/admin/api.ts` — `adminApi.getUserAttempts(id)` and the
  `AdminAttempt` type (`id, courseTitle, courseSlug, subjectSlug, score,
  startedAt, submittedAt`).

## Design

### Row expansion (AdminUsersPage.tsx)

- Add a toggle icon button in each row's Actions cell (chevron icon, consistent
  with the existing `UserIcon`/`TrashIcon` icon-button style), labeled
  "View attempts" / "Hide attempts" via `aria-label`/`title`.
- State: `expandedId: string | null` — only one row expanded at a time.
- State: `attemptsById: Record<string, AdminAttempt[]>` — cache per user so
  re-expanding doesn't refetch.
- State: `attemptsLoading: string | null` / `attemptsError: string | null` for
  the in-flight/error state of the current fetch.
- On expanding a row for the first time (no cache entry yet), call
  `adminApi.getUserAttempts(id)`, store the result in the cache. Toggling
  closed just clears `expandedId`; the cache persists for the session.
- Render an extra `<tr>` immediately below the user's row when
  `expandedId === u.id`, with a single `<td colSpan={6}>` holding the content
  below.

### Expanded content

- While loading: "Loading attempts…"
- On error: reuse the existing inline error paragraph pattern
  (`role="alert"`, class `auth-error`).
- If loaded and empty: "No attempts yet."
- Otherwise: a nested `admin-table` with columns **Subject / Course / Score /
  Status / Date**, showing only the 5 most recent attempts (the array is
  already newest-first from the backend):
  - Subject: `subjectSlug` (display as-is; no subject title is returned by
    the API today, so slug is shown).
  - Course: `courseTitle`.
  - Score: `score` if `submittedAt` is set, else `"—"`.
  - Status: `"Completed"` if `submittedAt` is set, else `"In progress"`.
  - Date: `new Date(submittedAt ?? startedAt).toLocaleDateString()`.
  - Row key: `id`.
- If the cached array has more than 5 entries, show a "View all N attempts"
  button below the mini table, where N is the total count.

### Full-history modal

- New component `frontend/src/pages/admin/UserAttemptsModal.tsx`:
  - Props: the target user's display name/email (for the heading) and the
    full `AdminAttempt[]` (reused from the cache — no extra fetch).
  - No modal component exists in the app yet, so this introduces the first
    one: a minimal fixed-position overlay (dimmed backdrop) + centered panel,
    styled with a new `admin-modal` CSS class alongside the existing
    `admin-table`/`admin-page` classes. Same columns as the inline table, all
    attempts, scrollable panel if the list is long, and a close button.
  - Opened by clicking "View all N attempts"; closed via the close button or
    an overlay click/Escape key.
- `AdminUsersPage` holds `modalUserId: string | null` to control whether the
  modal is open, reusing `attemptsById` for its data.

## Out of scope

- No backend changes.
- No pagination of the modal list (plain scroll is sufficient for now).
- No changes to subject display (slug vs. title) — follow-up if admins find
  the slug unclear.

## Testing

- Component test for `AdminUsersPage`: expanding a row fetches and renders
  attempts (including empty state and >5 "view all" case), collapsing hides
  them, re-expanding does not refetch (mock call count).
- Component test for `UserAttemptsModal`: renders all attempts, close button
  dismisses it.

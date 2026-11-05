# List pagination — design

## Context

Several admin-facing tables currently fetch and render their full dataset with no limit:

- Admin Users table (`frontend/src/pages/admin/AdminUsersPage.tsx`, backed by `GET /admin/users` → `listUsers()` in `backend/src/models/admin-user.model.ts`).
- The same page's user-import preview table (parsed rows from an uploaded file) and import-results table (created/skipped users) — both client-side arrays held in React state, not server-fetched.

This spec adds offset-based pagination to all three, via one shared pagination mechanism on each side (backend helper + frontend hook/component) so later resources can adopt the same pattern instead of reinventing it.

Out of scope: the courses-by-subject list (`SubjectCoursesPage.tsx` / `listCoursesBySubject()`) stays unpaginated — it's a small, curriculum-ordered list ("Quiz 3 of 12") where seeing the whole thing at once is the point.

## Backend

**New helper:** `backend/src/lib/pagination.ts`

- `PAGE_SIZE = 20` — fixed, not client-adjustable.
- `parsePage(req: Request): number` — reads `req.query.page`, defaults to `1` if missing/invalid, clamps to `>= 1`. Follows the existing loose `req.query` handling style already used in `catalog.controller.ts` (no zod schema for query params exists yet in this codebase; this doesn't introduce one).
- `type Page<T> = { items: T[]; total: number; page: number; pageSize: number }` — the shared response envelope for any paginated list endpoint.

**Model** (`backend/src/models/admin-user.model.ts`):

- `listUsers(page: number): Promise<PublicUser[]>` — add `.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)` to the existing `db.select(publicColumns).from(users).orderBy(users.createdAt)` query.
- `countUsers(): Promise<number>` — new, `db.select({ count: count() }).from(users)`, same `count()` pattern already used in `catalog.model.ts`.

**Controller** (`backend/src/controllers/admin-users.controller.ts`):

```ts
export async function getUsers(req: Request, res: Response): Promise<void> {
  const page = parsePage(req);
  const [items, total] = await Promise.all([listUsers(page), countUsers()]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
}
```

This changes the response shape from `{ users: PublicUser[] }` to `{ items, total, page, pageSize }` — the frontend `adminApi.listUsers()` client and `AdminUsersPage` both update to match (breaking change, but both sides ship together).

Two round-trips (list query + count query) rather than a window-function single query — simpler, consistent with how `catalog.model.ts` already separates concerns, and user-confirmed.

## Frontend

**New shared helper:** `frontend/src/shared/pagination.ts` (+ a small component file for the UI piece)

- `PAGE_SIZE = 20` — mirrors the backend constant; kept in sync by convention since there's no shared package between frontend/backend.
- `usePager(totalItems: number)` — hook owning `page` state (starts at `1`). Derives `totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))`, `canPrev = page > 1`, `canNext = page < totalPages`. Exposes `next()` / `prev()`. If `totalItems` shrinks such that the current `page` is now out of range (e.g. a row was deleted), resets `page` to the new last valid page.
- `<Pager page={page} totalPages={totalPages} onPrev={prev} onNext={next} />` — renders `[ < Prev ]  Page X of Y  [ Next > ]`; both buttons disabled at their respective ends. Styled with the existing admin table CSS conventions (new small class, e.g. `admin-pager`).

**Usage pattern 1 — server-paginated (Admin Users table):**

- `adminApi.listUsers(page: number)` now sends `?page=${page}` and returns `{ items, total, page, pageSize }`.
- `AdminUsersPage` holds `page` via `usePager(total)` (where `total` comes from the last fetch response, starting at `0`), refetches in an effect keyed on `page`, and renders `<Pager>` below the table. Existing `error`/`loading` state and `<p role="alert">` pattern are reused as-is for fetch failures on page change — no new error UX.

**Usage pattern 2 — client-paginated (import preview & import results tables):**

- These already hold full arrays in memory (`parsedRows`, `importResults.created`, `importResults.skipped`) from a file parse — no network round-trip needed for paging.
- Each table gets its own independent `usePager(array.length)` instance and slices locally: `array.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)`. Three independent page-state instances (preview rows, created, skipped), since they're separate sections a user may page through independently.

## Testing

- Unit test for `usePager`: can't go below page 1, can't go above `totalPages`, resets correctly when `totalItems` drops below the current page's start.
- Backend test: seed more than `PAGE_SIZE` users, assert `listUsers(2)` returns the correct second-page slice and `countUsers()` returns the right total.
